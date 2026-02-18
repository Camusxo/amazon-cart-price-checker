import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pg from 'pg';
const { Pool } = pg;

// --- 型定義 ---

enum ItemStatus {
    PENDING = 'PENDING',
    OK = 'OK',
    NO_OFFER = 'NO_OFFER',
    NOT_FOUND = 'NOT_FOUND',
    THROTTLED = 'THROTTLED',
    AUTH_ERROR = 'AUTH_ERROR',
    ERROR = 'ERROR'
}

interface ProductResult {
    asin: string;
    title: string | null;
    priceAmount: number | null;
    priceCurrency: string | null;
    availability: string | null;
    detailUrl: string | null;
    fetchedAt: string;
    status: ItemStatus;
    errorMessage?: string;
    janCode: string | null;         // JANコード
    monthlySold: number | null;     // 月間販売個数推定
}

interface OriginalRowData {
    rowIndex: number;
    originalRow: Record<string, string>;
    asin: string;
}

interface OriginalCsvData {
    headers: string[];
    asinColumn: string;
    priceColumn: string | null;
    rows: OriginalRowData[];
}

interface RunSession {
    id: string;
    userId: string;
    createdAt: number;
    items: ProductResult[];
    logs: string[];
    isRunning: boolean;
    queue: string[];
    stats: {
        total: number;
        processed: number;
        success: number;
        failed: number;
        startTime: number;
        endTime?: number;
    };
    originalCsvData?: OriginalCsvData;
}

interface KeepaProduct {
    asin: string;
    title?: string;
    domainId: number;
    csv?: number[][];
    lastUpdate?: number;
    eanList?: string[];          // JANコード（EAN）リスト
    upcList?: string[];          // UPCコードリスト（EAN変換でJAN取得可能）
    stats?: {                    // stats パラメータ使用時のみ設定される統計情報
        salesRankDrops30?: number;   // 30日間の売上ランク降下数 ≒ 月間販売個数
        salesRankDrops90?: number;
        salesRankDrops180?: number;
    };
}

interface KeepaApiResponse {
    timestamp: number;
    tokensLeft: number;
    refillIn: number;
    refillRate: number;
    tokenFlowReduction: number;
    tokensConsumed: number;
    processingTimeInMs: number;
    products?: KeepaProduct[];
    error?: {
        type: string;
        message: string;
    };
}

// --- 設定 ---
const PORT = process.env.PORT || 3000;
const KEEPA_API_KEY = process.env.KEEPA_API_KEY;
const KEEPA_DOMAIN = Number(process.env.KEEPA_DOMAIN || 5);
const CACHE_TTL = Number(process.env.CACHE_TTL_SECONDS || 3600);
const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID;
const RAKUTEN_ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY;
// 複数楽天アプリID対応（カンマ区切り）: 各IDごとに独立したレート制限 → 並列で5倍速
const RAKUTEN_APP_IDS: string[] = process.env.RAKUTEN_APP_IDS
    ? process.env.RAKUTEN_APP_IDS.split(',').map(id => id.trim()).filter(id => id.length > 0)
    : (RAKUTEN_APP_ID ? [RAKUTEN_APP_ID] : []);
let rakutenAppIdIndex = 0;
const JWT_SECRET = process.env.JWT_SECRET || 'price-checker-secret-key-change-in-production';
const ADMIN_ID = process.env.ADMIN_ID || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DATABASE_URL = process.env.DATABASE_URL;

// PostgreSQL接続プール
const pool = DATABASE_URL ? new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
}) : null;

// --- 認証関連 ---
type UserRole = 'admin' | 'member';

interface UserSettings {
    keepaApiKey?: string;
}

interface User {
    id: string;
    username: string;
    passwordHash: string;
    role: UserRole;
    createdAt: number;
    settings: UserSettings;
}

// インメモリユーザーストア
const users: Record<string, User> = {};

// テーブル自動作成関数
const initDatabase = async () => {
    if (!pool) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(100) PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(20) DEFAULT 'member',
                created_at BIGINT NOT NULL,
                settings JSONB DEFAULT '{}'
            );
            ALTER TABLE users ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}';
            CREATE TABLE IF NOT EXISTS search_history (
                id UUID PRIMARY KEY,
                user_id VARCHAR(100) NOT NULL,
                type VARCHAR(20) NOT NULL,
                created_at BIGINT NOT NULL,
                asin_count INTEGER NOT NULL,
                method VARCHAR(50),
                query_url TEXT,
                is_running BOOLEAN DEFAULT false,
                stats JSONB,
                items JSONB,
                original_csv_data JSONB
            );
            CREATE TABLE IF NOT EXISTS comparison_history (
                id UUID PRIMARY KEY,
                run_id UUID NOT NULL,
                user_id VARCHAR(100) NOT NULL,
                created_at BIGINT NOT NULL,
                is_running BOOLEAN DEFAULT false,
                stats JSONB,
                items JSONB
            );
            CREATE INDEX IF NOT EXISTS idx_search_history_user ON search_history(user_id);
            CREATE INDEX IF NOT EXISTS idx_comparison_history_user ON comparison_history(user_id);
        `);
        console.log('PostgreSQL: テーブル初期化完了');
    } catch (err) {
        console.error('PostgreSQL: テーブル初期化エラー:', err);
    }
};

// ユーザーをDBに保存
const saveUserToDB = async (user: User) => {
    if (!pool) return;
    try {
        await pool.query(
            `INSERT INTO users (id, username, password_hash, role, created_at, settings)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO UPDATE SET username=$2, password_hash=$3, role=$4, settings=$6`,
            [user.id, user.username, user.passwordHash, user.role, user.createdAt, JSON.stringify(user.settings || {})]
        );
    } catch (err) { console.error('DB: ユーザー保存エラー', err); }
};

// DBからユーザーを読み込み
const loadUsersFromDB = async () => {
    if (!pool) return;
    try {
        const result = await pool.query('SELECT * FROM users');
        for (const row of result.rows) {
            users[row.id] = {
                id: row.id,
                username: row.username,
                passwordHash: row.password_hash,
                role: row.role as UserRole,
                createdAt: Number(row.created_at),
                settings: row.settings || {},
            };
        }
        console.log(`DB: ${result.rows.length}件のユーザーを読み込み`);
    } catch (err) { console.error('DB: ユーザー読み込みエラー', err); }
};

// 検索実行をDBに保存
const saveRunToDB = async (run: RunSession, userId: string) => {
    if (!pool) return;
    try {
        await pool.query(
            `INSERT INTO search_history (id, user_id, type, created_at, asin_count, stats, items, original_csv_data, is_running)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (id) DO UPDATE SET stats=$6, items=$7, is_running=$9`,
            [run.id, userId, 'run', run.createdAt, run.stats.total,
             JSON.stringify(run.stats), JSON.stringify(run.items),
             run.originalCsvData ? JSON.stringify(run.originalCsvData) : null,
             run.isRunning]
        );
    } catch (err) { console.error('DB: 検索結果保存エラー', err); }
};

// 比較結果をDBに保存
const saveComparisonToDB = async (session: ComparisonSession, userId: string) => {
    if (!pool) return;
    try {
        await pool.query(
            `INSERT INTO comparison_history (id, run_id, user_id, created_at, stats, items, is_running)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (id) DO UPDATE SET stats=$5, items=$6, is_running=$7`,
            [session.id, session.runId, userId, session.createdAt,
             JSON.stringify(session.stats), JSON.stringify(session.items),
             session.isRunning]
        );
    } catch (err) { console.error('DB: 比較結果保存エラー', err); }
};

// 管理者アカウント初期化
const initAdmin = async () => {
    await initDatabase();
    await loadUsersFromDB();

    // DBにadminがない場合のみ作成
    if (!users['admin']) {
        const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
        users['admin'] = {
            id: 'admin',
            username: ADMIN_ID,
            passwordHash: hash,
            role: 'admin',
            createdAt: Date.now(),
            settings: {},
        };
        await saveUserToDB(users['admin']);
    }
    console.log(`管理者アカウント初期化: ${ADMIN_ID}`);
};
initAdmin();

// JWT認証ミドルウェア
const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'ログインが必要です' });
        return;
    }
    try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; role: UserRole };
        (req as any).user = decoded;
        next();
    } catch {
        res.status(401).json({ error: 'セッションが無効です。再ログインしてください' });
    }
};

// 管理者チェックミドルウェア
const adminOnly = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = (req as any).user;
    if (!user || user.role !== 'admin') {
        res.status(403).json({ error: '管理者権限が必要です' });
        return;
    }
    next();
};

const DOMAIN_CURRENCY_MAP: Record<number, { currency: string; urlDomain: string }> = {
    1: { currency: 'USD', urlDomain: 'www.amazon.com' },
    2: { currency: 'GBP', urlDomain: 'www.amazon.co.uk' },
    3: { currency: 'EUR', urlDomain: 'www.amazon.de' },
    4: { currency: 'EUR', urlDomain: 'www.amazon.fr' },
    5: { currency: 'JPY', urlDomain: 'www.amazon.co.jp' },
    6: { currency: 'CAD', urlDomain: 'www.amazon.ca' },
    7: { currency: 'CNY', urlDomain: 'www.amazon.cn' },
    8: { currency: 'EUR', urlDomain: 'www.amazon.it' },
    9: { currency: 'EUR', urlDomain: 'www.amazon.es' },
    10: { currency: 'INR', urlDomain: 'www.amazon.in' },
    11: { currency: 'MXN', urlDomain: 'www.amazon.com.mx' },
    12: { currency: 'BRL', urlDomain: 'www.amazon.com.br' },
};

// --- 比較関連の型定義 ---

type ComparisonStatus = 'MATCHED' | 'NO_MATCH' | 'PENDING' | 'ERROR';

interface RakutenProduct {
    itemName: string;
    itemPrice: number;
    itemUrl: string;
    shopName: string;
    shopUrl: string;
    imageUrl: string;
    pointRate: number;
    genreId: string;
}

interface RakutenCandidate {
    title: string;
    price: number;
    url: string;
    shopName: string;
    imageUrl: string;
    pointRate: number;
    similarityScore: number;
}

interface ComparisonItem {
    asin: string;
    amazonTitle: string;
    amazonPrice: number;
    amazonUrl: string;
    rakutenTitle: string | null;
    rakutenPrice: number | null;
    rakutenUrl: string | null;
    rakutenShop: string | null;
    rakutenImageUrl: string | null;
    rakutenPointRate: number;
    similarityScore: number;
    priceDiff: number | null;
    priceDiffPercent: number | null;
    estimatedFee: number;
    estimatedProfit: number | null;
    profitRate: number | null;
    status: ComparisonStatus;
    errorMessage?: string;
    janCode: string | null;
    monthlySold: number | null;
    memo: string;
    rakutenCandidates: RakutenCandidate[];  // 上位2〜3件の楽天候補
    favorite: boolean;    // お気に入りフラグ
}

interface ComparisonSession {
    id: string;
    runId: string;
    userId: string;
    createdAt: number;
    items: ComparisonItem[];
    isRunning: boolean;
    stats: {
        total: number;
        processed: number;
        matched: number;
        profitable: number;
    };
}

// --- 状態管理（インメモリ） ---
const runs: Record<string, RunSession> = {};
const itemCache: Record<string, { data: ProductResult; expiresAt: number }> = {};
const comparisons: Record<string, ComparisonSession> = {};

// --- Express設定 ---
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- ヘルパー関数 ---

const log = (runId: string, message: string): void => {
    if (runs[runId]) {
        const timestamp = new Date().toLocaleTimeString();
        runs[runId].logs.unshift(`[${timestamp}] ${message}`);
        if (runs[runId].logs.length > 100) runs[runId].logs.pop();
        console.log(`[Run ${runId.slice(0, 8)}] ${message}`);
    }
};

const getCachedItem = (asin: string): ProductResult | null => {
    const cached = itemCache[asin];
    if (cached && cached.expiresAt > Date.now()) {
        return cached.data;
    }
    return null;
};

const setCachedItem = (item: ProductResult): void => {
    itemCache[item.asin] = {
        data: item,
        expiresAt: Date.now() + (CACHE_TTL * 1000)
    };
};

// JPY等はセント換算不要
const CURRENCIES_WITHOUT_CENTS: Set<number> = new Set([5, 7, 10]);

const extractCurrentPrice = (csvData: number[][] | undefined, domainId: number): number | null => {
    if (!csvData) return null;

    const needsDivision = !CURRENCIES_WITHOUT_CENTS.has(domainId);

    // 0=Amazon価格, 1=新品マーケットプレイス最安値
    const amazonPrices = csvData[0];
    if (amazonPrices && amazonPrices.length >= 2) {
        const latestPrice = amazonPrices[amazonPrices.length - 1];
        if (latestPrice > 0) {
            return needsDivision ? Math.round(latestPrice / 100) : latestPrice;
        }
    }

    const marketplacePrices = csvData[1];
    if (marketplacePrices && marketplacePrices.length >= 2) {
        const latestPrice = marketplacePrices[marketplacePrices.length - 1];
        if (latestPrice > 0) {
            return needsDivision ? Math.round(latestPrice / 100) : latestPrice;
        }
    }

    return null;
};

// --- JANコード抽出（取得率向上） ---
const extractJanCode = (product: KeepaProduct): string | null => {
    // 1. eanList から日本JANコード（45xxxx / 49xxxx）を優先検索
    if (product.eanList && product.eanList.length > 0) {
        const japanJan = product.eanList.find(e => e.startsWith('45') || e.startsWith('49'));
        if (japanJan) return japanJan;
        // 日本JANがなければ最初のEANを返す
        return product.eanList[0];
    }
    // 2. upcList からEAN変換（UPC 12桁 → 先頭に0を付けて13桁EAN）
    if (product.upcList && product.upcList.length > 0) {
        for (const upc of product.upcList) {
            const ean = upc.length === 12 ? '0' + upc : upc;
            if (ean.startsWith('45') || ean.startsWith('49')) return ean;
        }
        // 日本JANでなくても最初のUPC変換を返す
        const firstEan = product.upcList[0].length === 12 ? '0' + product.upcList[0] : product.upcList[0];
        return firstEan;
    }
    return null;
};

// --- Keepa API ロジック ---

const fetchFromKeepa = async (asins: string[], runId: string, apiKey?: string): Promise<ProductResult[]> => {
    const effectiveKey = apiKey || KEEPA_API_KEY;
    if (!effectiveKey) {
        throw new Error("KEEPA_API_KEY が設定されていません。.envファイルを確認してください。");
    }

    const domainInfo = DOMAIN_CURRENCY_MAP[KEEPA_DOMAIN] || DOMAIN_CURRENCY_MAP[5];

    try {
        const response = await axios.get<KeepaApiResponse>('https://api.keepa.com/product', {
            params: {
                key: effectiveKey,
                domain: KEEPA_DOMAIN,
                asin: asins.join(','),
                stats: 30,
            },
            timeout: 30000,
        });

        const data = response.data;

        if (data.error) {
            if (data.error.type === 'PAYMENT_REQUIRED') {
                throw new Error('AUTH_ERROR: Keepa APIのトークンが不足しています。');
            }
            if (data.error.type === 'INVALID_REQUEST') {
                throw new Error(`API_ERROR: ${data.error.message}`);
            }
            throw new Error(`KEEPA_ERROR: ${data.error.message}`);
        }

        log(runId, `Keepa API: 残りトークン ${data.tokensLeft}, 消費 ${data.tokensConsumed}`);

        const results: ProductResult[] = [];

        if (data.products) {
            data.products.forEach((product) => {
                const price = extractCurrentPrice(product.csv, KEEPA_DOMAIN);
                const hasPrice = price !== null && price > 0;

                results.push({
                    asin: product.asin,
                    title: product.title || null,
                    priceAmount: price,
                    priceCurrency: hasPrice ? domainInfo.currency : null,
                    availability: hasPrice ? '在庫あり' : null,
                    detailUrl: `https://${domainInfo.urlDomain}/dp/${product.asin}`,
                    fetchedAt: new Date().toISOString(),
                    status: hasPrice ? ItemStatus.OK : ItemStatus.NO_OFFER,
                    janCode: extractJanCode(product) || null,
                    monthlySold: (product.stats?.salesRankDrops30 ?? -1) > 0 ? product.stats!.salesRankDrops30! : null,
                });
            });
        }

        const returnedAsins = new Set(results.map(r => r.asin));
        asins.forEach(asin => {
            if (!returnedAsins.has(asin)) {
                results.push({
                    asin,
                    title: null,
                    priceAmount: null,
                    priceCurrency: null,
                    availability: null,
                    detailUrl: null,
                    fetchedAt: new Date().toISOString(),
                    status: ItemStatus.NOT_FOUND,
                    errorMessage: 'Keepa APIで商品が見つかりませんでした',
                    janCode: null,
                    monthlySold: null,
                });
            }
        });

        return results;

    } catch (error: unknown) {
        const err = error as { response?: { status: number }; message?: string };
        if (err.response?.status === 429) {
            throw new Error('THROTTLED');
        }
        if (err.response?.status === 401 || err.response?.status === 402) {
            throw new Error('AUTH_ERROR');
        }
        if (err.message?.includes('AUTH_ERROR')) {
            throw new Error('AUTH_ERROR');
        }
        throw error;
    }
};

// --- キュー処理 ---

const processQueue = async (runId: string): Promise<void> => {
    const run = runs[runId];
    if (!run || !run.isRunning) return;

    if (run.queue.length === 0) {
        run.isRunning = false;
        run.stats.endTime = Date.now();
        log(runId, '処理が完了しました。');

        // 完了時にDBへ保存
        if (run.userId) saveRunToDB(run, run.userId);

        return;
    }

    const batchSize = Math.min(100, run.queue.length);
    const batch = run.queue.slice(0, batchSize);
    run.queue = run.queue.slice(batchSize);

    const asinsToFetch: string[] = [];

    batch.forEach(asin => {
        const cached = getCachedItem(asin);
        if (cached) {
            const existingIndex = run.items.findIndex(i => i.asin === asin);
            if (existingIndex !== -1) {
                run.items[existingIndex] = cached;
            }
            run.stats.processed++;
            run.stats.success++;
        } else {
            asinsToFetch.push(asin);
        }
    });

    if (asinsToFetch.length === 0) {
        setTimeout(() => processQueue(runId), 100);
        return;
    }

    let attempts = 0;
    const maxAttempts = 3;
    let success = false;

    // ユーザーのKeepa APIキーを解決（ユーザーキー優先、なければサーバーキー）
    const userKeepaKey = run.userId && users[run.userId]?.settings?.keepaApiKey || undefined;

    while (attempts < maxAttempts && !success) {
        try {
            log(runId, `${asinsToFetch.length}件のアイテムを取得中...（試行 ${attempts + 1}）${userKeepaKey ? ' [ユーザーキー]' : ' [サーバーキー]'}`);
            const fetchedItems = await fetchFromKeepa(asinsToFetch, runId, userKeepaKey);

            fetchedItems.forEach(item => {
                const idx = run.items.findIndex(i => i.asin === item.asin);
                if (idx !== -1) {
                    run.items[idx] = item;
                }
                setCachedItem(item);
            });

            const successCount = fetchedItems.filter(i => i.status === ItemStatus.OK).length;
            run.stats.processed += asinsToFetch.length;
            run.stats.success += successCount;
            run.stats.failed += (asinsToFetch.length - successCount);

            success = true;

        } catch (error: unknown) {
            attempts++;
            const err = error as { message?: string };
            const isThrottle = err.message === 'THROTTLED';
            const isAuthError = err.message === 'AUTH_ERROR' || err.message?.includes('AUTH_ERROR');

            if (isThrottle && attempts < maxAttempts) {
                const waitTime = Math.pow(2, attempts) * 2000;
                log(runId, `レート制限。${waitTime / 1000}秒待機中...`);
                await new Promise(r => setTimeout(r, waitTime));
            } else if (isAuthError) {
                log(runId, `⚠ トークン枯渇: Keepa APIトークンが不足しています。処理を停止します。`);
                // 現在のバッチを失敗にする
                asinsToFetch.forEach(asin => {
                    const idx = run.items.findIndex(i => i.asin === asin);
                    if (idx !== -1) {
                        run.items[idx].status = ItemStatus.AUTH_ERROR;
                        run.items[idx].errorMessage = 'Keepa APIトークン不足。トークン回復後に「失敗を再実行」で再処理できます。';
                    }
                });
                run.stats.processed += asinsToFetch.length;
                run.stats.failed += asinsToFetch.length;
                // 残りのキューも全て未処理のままにしてキューを停止
                const remainingCount = run.queue.length;
                if (remainingCount > 0) {
                    log(runId, `残り${remainingCount}件は未処理のまま保留。トークン回復後に「失敗を再実行」してください。`);
                }
                run.isRunning = false;
                run.stats.endTime = Date.now();
                if (run.userId) saveRunToDB(run, run.userId);
                return; // processQueue を再スケジュールしない
            } else {
                log(runId, `バッチ処理失敗: ${err.message}`);
                asinsToFetch.forEach(asin => {
                    const idx = run.items.findIndex(i => i.asin === asin);
                    if (idx !== -1) {
                        run.items[idx].status = isThrottle ? ItemStatus.THROTTLED : ItemStatus.ERROR;
                        run.items[idx].errorMessage = err.message || 'Unknown error';
                    }
                });
                run.stats.processed += asinsToFetch.length;
                run.stats.failed += asinsToFetch.length;
                break;
            }
        }
    }

    setTimeout(() => processQueue(runId), 500);
};

// --- 楽天API関連 ---

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// ラウンドロビンで次の楽天アプリIDを取得
const getNextRakutenAppId = (): string => {
    if (RAKUTEN_APP_IDS.length === 0) throw new Error('RAKUTEN_APP_ID が設定されていません。');
    const appId = RAKUTEN_APP_IDS[rakutenAppIdIndex % RAKUTEN_APP_IDS.length];
    rakutenAppIdIndex++;
    return appId;
};

const searchRakuten = async (keyword: string, appId?: string): Promise<RakutenProduct[]> => {
    const effectiveAppId = appId || getNextRakutenAppId();

    // 検索キーワードを最適化（長すぎる商品名から主要キーワードを抽出）
    const optimizedKeyword = keyword
        .replace(/[\[\]【】（）()「」『』]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(w => w.length > 1)
        .slice(0, 5)
        .join(' ');

    if (!optimizedKeyword) return [];

    try {
        const params: Record<string, string | number> = {
            applicationId: effectiveAppId,
            keyword: optimizedKeyword,
            hits: 30,
            sort: '+itemPrice',
            formatVersion: 2,
        };
        if (RAKUTEN_ACCESS_KEY) {
            params.accessKey = RAKUTEN_ACCESS_KEY;
        }

        const response = await axios.get('https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601', {
            params,
            headers: {
                'Referer': 'https://amazon-price-checker-xohy.onrender.com/',
                'Origin': 'https://amazon-price-checker-xohy.onrender.com',
            },
            timeout: 10000,
        });

        const items = response.data.Items || [];
        return items.map((item: Record<string, unknown>) => ({
            itemName: item.itemName as string,
            itemPrice: item.itemPrice as number,
            itemUrl: item.itemUrl as string,
            shopName: item.shopName as string,
            shopUrl: item.shopUrl as string || '',
            imageUrl: ((item.mediumImageUrls as string[]) || [])[0] || '',
            pointRate: (item.pointRate as number) || 1,
            genreId: String(item.genreId || ''),
        }));
    } catch (error: unknown) {
        const err = error as { response?: { status: number; data?: Record<string, unknown> }; message?: string };
        console.error(`楽天API error: status=${err.response?.status}, data=${JSON.stringify(err.response?.data)}, keyword="${optimizedKeyword}"`);
        if (err.response?.status === 429) {
            throw new Error('RAKUTEN_THROTTLED');
        }
        if (err.response?.status === 404) {
            return [];
        }
        if (err.response?.status === 400) {
            // 検索結果0件の場合も400が返ることがある
            return [];
        }
        throw error;
    }
};

// bigram Dice coefficient による文字列類似度
const getBigrams = (str: string): Set<string> => {
    const s = str.toLowerCase().replace(/\s+/g, '');
    const bigrams = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) {
        bigrams.add(s.substring(i, i + 2));
    }
    return bigrams;
};

const calculateBigramSimilarity = (str1: string, str2: string): number => {
    if (!str1 || !str2) return 0;
    const bigrams1 = getBigrams(str1);
    const bigrams2 = getBigrams(str2);
    if (bigrams1.size === 0 || bigrams2.size === 0) return 0;

    let intersection = 0;
    bigrams1.forEach(bg => {
        if (bigrams2.has(bg)) intersection++;
    });

    return (2 * intersection) / (bigrams1.size + bigrams2.size);
};

// --- 高精度マッチングシステム（一致率95%以上対応） ---

// 型番・規格番号を抽出（例: ABC-123, X100V, KJ-55X85K, NW-A306）
const extractModelNumbers = (title: string): string[] => {
    const models: string[] = [];
    // アルファベット+数字の型番パターン（ハイフン含む）
    const patterns = [
        /[A-Z]{1,6}[-]?\d{2,6}[A-Z]{0,3}/gi,          // ABC-123, KJ55X85K
        /[A-Z]{1,3}\d{1,3}[-]\d{1,6}[A-Z]?/gi,        // NW-A306, WH-1000XM5
        /\d{2,4}[-][A-Z]{1,4}\d{0,4}/gi,               // 55-X85K
        /[A-Z]\d{3,5}[A-Z]{0,2}/gi,                    // A306, X100V
    ];
    for (const pattern of patterns) {
        const matches = title.match(pattern) || [];
        for (const m of matches) {
            const normalized = m.toUpperCase().replace(/-/g, '');
            if (normalized.length >= 3 && !models.includes(normalized)) {
                models.push(normalized);
            }
        }
    }
    return models;
};

// 容量・サイズ・個数などのスペック情報を抽出
const extractSpecs = (title: string): string[] => {
    const specs: string[] = [];
    // 容量・重量
    const specPatterns = [
        /\d+(?:\.\d+)?(?:ml|ML|ml|mL|リットル|L|l)/gi,
        /\d+(?:\.\d+)?(?:g|kg|KG|グラム)/gi,
        /\d+(?:\.\d+)?(?:cm|mm|m|インチ|型)/gi,
        /\d+(?:個|枚|本|入|袋|箱|パック|セット|錠|粒|包|回分)/gi,
        /(?:S|M|L|XL|XXL|LL|3L|4L|5L)サイズ/gi,
        /第\d+世代/gi,
        /\d{4}年(?:モデル|版|製)/gi,
        /[Vv](?:er)?\.?\s?\d+(?:\.\d+)?/gi,   // v2, Ver.3, v1.5
    ];
    for (const pattern of specPatterns) {
        const matches = title.match(pattern) || [];
        for (const m of matches) {
            const normalized = m.toLowerCase().replace(/\s/g, '');
            if (!specs.includes(normalized)) {
                specs.push(normalized);
            }
        }
    }
    return specs;
};

// ブランド名の正規化抽出（先頭の主要ワードをブランド候補として取得）
const extractBrandHint = (title: string): string => {
    // カッコや記号を除去してから先頭ワードを取得
    const cleaned = title.replace(/[\[\]【】（）()「」『』]/g, ' ').trim();
    const words = cleaned.split(/\s+/).filter(w => w.length > 0);
    // 先頭1〜2ワードをブランド候補として返す（日本語商品名の慣習）
    return words.slice(0, 2).join(' ').toLowerCase();
};

// 高精度類似度計算（型番・スペック・ブランドを加味）
const calculateSimilarity = (amazonTitle: string, rakutenTitle: string): number => {
    // Step 1: 基本bigram類似度
    const bigramScore = calculateBigramSimilarity(amazonTitle, rakutenTitle);

    // Step 2: 型番チェック（致命的な不一致で大幅減点）
    const amazonModels = extractModelNumbers(amazonTitle);
    const rakutenModels = extractModelNumbers(rakutenTitle);

    let modelPenalty = 0;
    if (amazonModels.length > 0 && rakutenModels.length > 0) {
        // 両方に型番がある場合、少なくとも1つは一致する必要がある
        const hasModelMatch = amazonModels.some(am =>
            rakutenModels.some(rm => am === rm || am.includes(rm) || rm.includes(am))
        );
        if (!hasModelMatch) {
            // 型番が1つも一致しない → 別商品の可能性が極めて高い
            modelPenalty = 0.30;
        }
    }

    // Step 3: スペックチェック（容量・サイズ不一致で減点）
    const amazonSpecs = extractSpecs(amazonTitle);
    const rakutenSpecs = extractSpecs(rakutenTitle);

    let specPenalty = 0;
    if (amazonSpecs.length > 0 && rakutenSpecs.length > 0) {
        // 同じカテゴリのスペックが異なる場合に減点
        const specMatch = amazonSpecs.some(as =>
            rakutenSpecs.some(rs => as === rs)
        );
        if (!specMatch) {
            specPenalty = 0.15;
        }
    }

    // Step 4: ブランドチェック
    const amazonBrand = extractBrandHint(amazonTitle);
    const rakutenBrand = extractBrandHint(rakutenTitle);
    let brandPenalty = 0;
    if (amazonBrand && rakutenBrand) {
        const brandSim = calculateBigramSimilarity(amazonBrand, rakutenBrand);
        if (brandSim < 0.4) {
            brandPenalty = 0.10;
        }
    }

    // 最終スコア = bigram類似度 - 各種ペナルティ
    const finalScore = Math.max(0, bigramScore - modelPenalty - specPenalty - brandPenalty);
    return finalScore;
};

// Amazon手数料概算（販売手数料15% + FBA配送代行手数料）
// QUICKSHOPの計算に準拠: 販売手数料 + FBA配送料
const estimateAmazonFee = (price: number): number => {
    // 販売手数料: 15%（大半のカテゴリ）
    const referralFee = Math.round(price * 0.15);
    // FBA配送代行手数料（サイズ別概算）
    // 小型: ~434円, 標準: ~514円, 大型標準: ~603円, 大型: ~712円+
    // 価格帯から推定サイズを判定
    let fbaFee: number;
    if (price <= 1500) {
        fbaFee = 434;  // 小型軽量
    } else if (price <= 5000) {
        fbaFee = 514;  // 標準サイズ
    } else if (price <= 10000) {
        fbaFee = 603;  // やや大きめ標準
    } else {
        fbaFee = 712;  // 大型
    }
    return referralFee + fbaFee;
};

// 単一アイテムの楽天比較処理
const processComparisonItem = async (item: ComparisonItem, session: ComparisonSession, appId: string): Promise<void> => {
    try {
        const rakutenResults = await searchRakuten(item.amazonTitle, appId);

        if (rakutenResults.length === 0) {
            item.status = 'NO_MATCH';
            item.rakutenTitle = null;
            item.rakutenPrice = null;
            item.rakutenCandidates = [];
            session.stats.processed++;
            return;
        }

        const scoredResults = rakutenResults
            .map(rp => ({
                ...rp,
                score: calculateSimilarity(item.amazonTitle, rp.itemName)
            }))
            .sort((a, b) => b.score - a.score)
            .filter(r => r.score >= 0.5)  // 候補の最低閾値50%
            .slice(0, 3);

        item.rakutenCandidates = scoredResults.map(r => ({
            title: r.itemName,
            price: r.itemPrice,
            url: r.itemUrl,
            shopName: r.shopName,
            imageUrl: r.imageUrl || '',
            pointRate: r.pointRate || 1,
            similarityScore: r.score,
        }));

        const bestMatch = scoredResults[0] || null;
        const bestScore = bestMatch?.score || 0;

        // 一致率95%以上 + 楽天価格がAmazon以下の場合のみMATCHED
        const MATCH_THRESHOLD = 0.95;
        if (bestMatch && bestScore >= MATCH_THRESHOLD) {
            // 楽天の方が高い場合は利益が出ないのでNO_MATCHとして扱う
            if (bestMatch.itemPrice >= item.amazonPrice) {
                item.status = 'NO_MATCH';
                item.rakutenTitle = bestMatch.itemName;
                item.rakutenPrice = bestMatch.itemPrice;
                item.rakutenUrl = bestMatch.itemUrl;
                item.rakutenShop = bestMatch.shopName;
                item.similarityScore = bestScore;
                item.errorMessage = '楽天価格がAmazon以上のため除外';
            } else {
                item.status = 'MATCHED';
                item.rakutenTitle = bestMatch.itemName;
                item.rakutenPrice = bestMatch.itemPrice;
                item.rakutenUrl = bestMatch.itemUrl;
                item.rakutenShop = bestMatch.shopName;
                item.rakutenImageUrl = bestMatch.imageUrl;
                item.rakutenPointRate = bestMatch.pointRate;
                item.similarityScore = bestScore;

                item.priceDiff = item.amazonPrice - bestMatch.itemPrice;
                item.priceDiffPercent = Math.round(((item.amazonPrice - bestMatch.itemPrice) / item.amazonPrice) * 100 * 10) / 10;

                item.estimatedFee = estimateAmazonFee(item.amazonPrice);
                item.estimatedProfit = item.amazonPrice - bestMatch.itemPrice - item.estimatedFee;
                item.profitRate = Math.round((item.estimatedProfit / item.amazonPrice) * 100 * 10) / 10;

                session.stats.matched++;
                if (item.estimatedProfit > 0) {
                    session.stats.profitable++;
                }
            }
        } else {
            item.status = 'NO_MATCH';
            if (bestMatch) {
                item.rakutenTitle = bestMatch.itemName;
                item.rakutenPrice = bestMatch.itemPrice;
                item.rakutenUrl = bestMatch.itemUrl;
                item.rakutenShop = bestMatch.shopName;
                item.similarityScore = bestScore;
            }
        }

        session.stats.processed++;

    } catch (error: unknown) {
        const err = error as { message?: string };
        if (err.message === 'RAKUTEN_THROTTLED') {
            throw error; // 呼び出し元でリトライ
        }
        item.status = 'ERROR';
        item.errorMessage = err.message || '楽天API検索エラー';
        session.stats.processed++;
    }
};

// 比較キュー処理（複数アプリID並列ワーカー）
const processComparisonQueue = async (compareId: string): Promise<void> => {
    const session = comparisons[compareId];
    if (!session || !session.isRunning) return;

    const pendingItems = session.items.filter(i => i.status === 'PENDING');
    if (pendingItems.length === 0) {
        session.isRunning = false;
        if (session.userId) saveComparisonToDB(session, session.userId);
        return;
    }

    const workerCount = Math.min(RAKUTEN_APP_IDS.length, pendingItems.length);

    if (workerCount <= 1) {
        // 単一ワーカー（従来動作）
        const appId = RAKUTEN_APP_IDS[0] || RAKUTEN_APP_ID || '';
        for (const item of pendingItems) {
            if (!session.isRunning) break;
            try {
                await processComparisonItem(item, session, appId);
            } catch {
                await delay(3000); // THROTTLED時リトライ待ち
                try { await processComparisonItem(item, session, appId); } catch { /* skip */ }
            }
            await delay(1100);
        }
    } else {
        // 複数アプリID並列ワーカー: アイテムをワーカーに分配
        const workerQueues: ComparisonItem[][] = Array.from({ length: workerCount }, () => []);
        pendingItems.forEach((item, idx) => {
            workerQueues[idx % workerCount].push(item);
        });

        const workerPromises = workerQueues.map(async (queue, workerIdx) => {
            const appId = RAKUTEN_APP_IDS[workerIdx];
            for (const item of queue) {
                if (!session.isRunning) break;
                try {
                    await processComparisonItem(item, session, appId);
                } catch {
                    await delay(3000);
                    try { await processComparisonItem(item, session, appId); } catch { /* skip */ }
                }
                await delay(1100); // 各ワーカーはそれぞれ1req/秒制限
            }
        });

        await Promise.all(workerPromises);
    }

    session.isRunning = false;
    if (session.userId) saveComparisonToDB(session, session.userId);
};

// --- APIルート ---

// --- 認証APIルート ---

// ログイン
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        res.status(400).json({ error: 'ユーザー名とパスワードが必要です' });
        return;
    }

    const user = Object.values(users).find(u => u.username === username);
    if (!user) {
        res.status(401).json({ error: 'ユーザー名またはパスワードが正しくありません' });
        return;
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
        res.status(401).json({ error: 'ユーザー名またはパスワードが正しくありません' });
        return;
    }

    const token = jwt.sign({ userId: user.id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// 現在のユーザー情報
app.get('/api/auth/me', authMiddleware, (req, res) => {
    const { userId, role, username } = (req as any).user;
    res.json({ id: userId, username, role });
});

// 管理者: ユーザー一覧
app.get('/api/admin/users', authMiddleware, adminOnly, (_req, res) => {
    const userList = Object.values(users).map(u => ({
        id: u.id,
        username: u.username,
        role: u.role,
        createdAt: u.createdAt,
        hasKeepaKey: !!u.settings?.keepaApiKey,
    }));
    res.json(userList);
});

// 管理者: ユーザー登録
app.post('/api/admin/users', authMiddleware, adminOnly, async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password) {
        res.status(400).json({ error: 'ユーザー名とパスワードが必要です' });
        return;
    }
    if (Object.values(users).some(u => u.username === username)) {
        res.status(400).json({ error: 'このユーザー名は既に使用されています' });
        return;
    }
    const validRole: UserRole = role === 'admin' ? 'admin' : 'member';
    const hash = await bcrypt.hash(password, 10);
    const id = `user_${Date.now()}`;
    users[id] = { id, username, passwordHash: hash, role: validRole, createdAt: Date.now(), settings: {} };
    await saveUserToDB(users[id]);
    res.json({ id, username, role: validRole });
});

// 管理者: ユーザー削除
app.delete('/api/admin/users/:userId', authMiddleware, adminOnly, async (req, res) => {
    const { userId } = req.params;
    if (userId === 'admin') {
        res.status(400).json({ error: '管理者アカウントは削除できません' });
        return;
    }
    if (!users[userId]) {
        res.status(404).json({ error: 'ユーザーが見つかりません' });
        return;
    }
    delete users[userId];
    // DBからも削除
    if (pool) {
        try {
            await pool.query('DELETE FROM users WHERE id=$1', [userId]);
        } catch (err) { console.error('DB: ユーザー削除エラー', err); }
    }
    res.json({ ok: true });
});

// 管理者: パスワード変更
app.patch('/api/admin/users/:userId/password', authMiddleware, adminOnly, async (req, res) => {
    const { userId } = req.params;
    const { password } = req.body;
    if (!password || password.length < 4) {
        res.status(400).json({ error: 'パスワードは4文字以上必要です' });
        return;
    }
    const user = users[userId];
    if (!user) { res.status(404).json({ error: 'ユーザーが見つかりません' }); return; }
    user.passwordHash = await bcrypt.hash(password, 10);
    await saveUserToDB(user);
    res.json({ ok: true });
});

// --- 管理者: ユーザーのKeepa APIキー管理 ---

// キー取得（マスク表示）
app.get('/api/admin/users/:userId/keepa-key', authMiddleware, adminOnly, (req, res) => {
    const { userId } = req.params;
    const user = users[userId];
    if (!user) { res.status(404).json({ error: 'ユーザーが見つかりません' }); return; }
    const key = user.settings?.keepaApiKey;
    res.json({
        hasKey: !!key,
        maskedKey: key ? key.slice(0, 4) + '****' + key.slice(-4) : null,
    });
});

// キー設定（検証付き）
app.put('/api/admin/users/:userId/keepa-key', authMiddleware, adminOnly, async (req, res) => {
    const { userId } = req.params;
    const { apiKey } = req.body;
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 10) {
        res.status(400).json({ error: '有効なKeepa APIキーを入力してください' });
        return;
    }
    const user = users[userId];
    if (!user) { res.status(404).json({ error: 'ユーザーが見つかりません' }); return; }

    // キー検証: Keepa token APIで有効性チェック
    try {
        const tokenRes = await axios.get('https://api.keepa.com/token', {
            params: { key: apiKey.trim() },
            timeout: 10000,
        });
        const tokenData = tokenRes.data;

        // キーを保存
        if (!user.settings) user.settings = {};
        user.settings.keepaApiKey = apiKey.trim();
        await saveUserToDB(user);

        res.json({
            ok: true,
            tokensLeft: tokenData.tokensLeft || 0,
            refillRate: tokenData.refillRate || 0,
        });
    } catch (error: unknown) {
        const err = error as { response?: { status: number }; message?: string };
        if (err.response?.status === 401 || err.response?.status === 402) {
            res.status(400).json({ error: '無効なKeepa APIキーです' });
            return;
        }
        res.status(500).json({ error: `キー検証エラー: ${err.message}` });
    }
});

// キー削除
app.delete('/api/admin/users/:userId/keepa-key', authMiddleware, adminOnly, async (req, res) => {
    const { userId } = req.params;
    const user = users[userId];
    if (!user) { res.status(404).json({ error: 'ユーザーが見つかりません' }); return; }
    if (!user.settings) user.settings = {};
    delete user.settings.keepaApiKey;
    await saveUserToDB(user);
    res.json({ ok: true });
});

// --- 以降のAPIルートに認証を適用 ---
app.use('/api/runs', authMiddleware);
app.use('/api/compare', authMiddleware);
app.use('/api/history', authMiddleware);
app.use('/api/status', authMiddleware);

// --- Keepa検索API ---
app.get('/api/keepa-search', authMiddleware, async (req, res) => {
    const keyword = req.query.keyword as string;
    if (!keyword || keyword.trim().length === 0) {
        res.status(400).json({ error: '検索キーワードが必要です' });
        return;
    }
    // ユーザーのKeepa APIキーを優先、なければサーバーキー
    const userId = (req as any).user?.userId;
    const userKeepaKey = userId && users[userId]?.settings?.keepaApiKey || undefined;
    const effectiveKey = userKeepaKey || KEEPA_API_KEY;
    if (!effectiveKey) {
        res.status(500).json({ error: 'KEEPA_API_KEYが設定されていません' });
        return;
    }

    try {
        const response = await axios.get<KeepaApiResponse>('https://api.keepa.com/search', {
            params: {
                key: effectiveKey,
                domain: KEEPA_DOMAIN,
                type: 'product',
                term: keyword.trim(),
                stats: 30,
                page: 0,
            },
            timeout: 30000,
        });

        const data = response.data;
        if (data.error) {
            res.status(400).json({ error: data.error.message });
            return;
        }

        const domainInfo = DOMAIN_CURRENCY_MAP[KEEPA_DOMAIN] || DOMAIN_CURRENCY_MAP[5];
        const products = (data.products || []).slice(0, 30).map(p => ({
            asin: p.asin,
            title: p.title || null,
            price: extractCurrentPrice(p.csv, KEEPA_DOMAIN),
            currency: domainInfo.currency,
            imageUrl: p.asin ? `https://images-na.ssl-images-amazon.com/images/I/${p.asin}.jpg` : null,
            janCode: extractJanCode(p) || null,
            monthlySold: (p.stats?.salesRankDrops30 ?? -1) > 0 ? p.stats!.salesRankDrops30! : null,
        }));

        res.json({
            products,
            tokensLeft: data.tokensLeft,
            tokensConsumed: data.tokensConsumed,
        });
    } catch (error: unknown) {
        const err = error as { response?: { status: number; data?: any }; message?: string };
        if (err.response?.status === 429) {
            res.status(429).json({ error: 'Keepa APIレート制限。しばらく待ってから再試行してください' });
            return;
        }
        if (err.response?.status === 401 || err.response?.status === 402) {
            res.status(401).json({ error: 'Keepa API認証エラー。APIキーを確認してください' });
            return;
        }
        res.status(500).json({ error: `Keepa検索エラー: ${err.message}` });
    }
});

// --- Keepaトークン残量確認API ---
app.get('/api/keepa-tokens', authMiddleware, async (req, res) => {
    // ユーザーのKeepa APIキーを優先、なければサーバーキー
    const userId = (req as any).user?.userId;
    const userKeepaKey = userId && users[userId]?.settings?.keepaApiKey || undefined;
    const effectiveKey = userKeepaKey || KEEPA_API_KEY;
    if (!effectiveKey) {
        res.status(500).json({ error: 'KEEPA_API_KEYが設定されていません' });
        return;
    }
    try {
        const response = await axios.get('https://api.keepa.com/token', {
            params: { key: effectiveKey },
            timeout: 10000,
        });
        const data = response.data;
        // トークン1つあたり処理可能ASIN数の目安（product APIは100ASINで約2トークン消費）
        const estimatedAsins = Math.floor((data.tokensLeft || 0) / 2) * 100;
        res.json({
            tokensLeft: data.tokensLeft || 0,
            refillIn: data.refillIn || 0,       // 次回補充までの秒数
            refillRate: data.refillRate || 0,    // 1分あたりの補充量
            estimatedAsins,                       // 処理可能ASIN数の目安
            keySource: userKeepaKey ? 'user' : 'server',
        });
    } catch (error: unknown) {
        const err = error as { message?: string };
        res.status(500).json({ error: `トークン確認エラー: ${err.message}` });
    }
});

// --- Keepaクエリ（Product Finder）API ---
app.post('/api/keepa-query', authMiddleware, async (req, res) => {
    const { queryUrl, selection, domain } = req.body;

    // ユーザーのKeepa APIキーを優先、なければサーバーキー
    const userId = (req as any).user?.userId;
    const userKeepaKey = userId && users[userId]?.settings?.keepaApiKey || undefined;
    const effectiveKeepaKey = userKeepaKey || KEEPA_API_KEY;
    if (!effectiveKeepaKey) {
        res.status(500).json({ error: 'KEEPA_API_KEYが設定されていません' });
        return;
    }

    let parsedSelection: any;
    let parsedDomain: number = KEEPA_DOMAIN;

    // URLからパラメータを解析
    if (queryUrl) {
        try {
            const url = new URL(queryUrl);
            const selectionParam = url.searchParams.get('selection');
            const domainParam = url.searchParams.get('domain');
            if (!selectionParam) {
                res.status(400).json({ error: 'URLにselectionパラメータが見つかりません' });
                return;
            }
            parsedSelection = JSON.parse(selectionParam);
            if (domainParam) parsedDomain = parseInt(domainParam, 10);
        } catch (e) {
            res.status(400).json({ error: 'URLの解析に失敗しました。正しいKeepaクエリURLを入力してください' });
            return;
        }
    } else if (selection) {
        parsedSelection = selection;
        if (domain) parsedDomain = domain;
    } else {
        res.status(400).json({ error: 'queryUrl または selection パラメータが必要です' });
        return;
    }

    // catchブロックでも参照するため、try外で宣言
    const tokenBudget = req.body.tokenBudget || 0; // 0=制限なし
    const maxResults = tokenBudget > 0 ? Math.min(tokenBudget, req.body.maxResults || 5000) : (req.body.maxResults || 5000);
    const maxPages = Math.min(req.body.maxPages || 50, 50);
    let allAsinList: string[] = [];
    let totalResults = 0;
    let tokensLeft = 0;
    let totalTokensConsumed = 0;
    let page = 0;

    try {
        // 複数ページ取得でより多くの結果を取得
        while (page < maxPages) {
            const response = await axios.get('https://api.keepa.com/query', {
                params: {
                    key: effectiveKeepaKey,
                    domain: parsedDomain,
                    selection: JSON.stringify(parsedSelection),
                    page,
                },
                timeout: 60000,
            });

            const data = response.data;
            if (data.error) {
                if (page === 0) {
                    res.status(400).json({ error: data.error.message || 'Keepaクエリエラー' });
                    return;
                }
                break; // 2ページ目以降のエラーは取得済み分で返す
            }

            const pageAsins: string[] = data.asinList || [];
            totalResults = data.totalResults || totalResults;
            tokensLeft = data.tokensLeft || 0;
            totalTokensConsumed += data.tokensConsumed || 0;

            allAsinList = allAsinList.concat(pageAsins);

            // 次ページがない場合（取得数が0、全件取得済み、または上限到達）
            if (pageAsins.length === 0 || allAsinList.length >= totalResults || allAsinList.length >= maxResults) {
                break;
            }

            // トークン残量が尽きた場合はここまでの取得分で終了
            if (tokensLeft <= 0) {
                break;
            }

            page++;

            // ページ間に少し待機（レート制限対策）
            if (page < maxPages) {
                await delay(500);
            }
        }

        // 重複除去
        allAsinList = [...new Set(allAsinList)];

        res.json({
            asinList: allAsinList,
            totalResults,
            returnedCount: allAsinList.length,
            pagesRetrieved: page + 1,
            selection: parsedSelection,
            domain: parsedDomain,
            tokensLeft,
            tokensConsumed: totalTokensConsumed,
        });
    } catch (error: unknown) {
        const err = error as { response?: { status: number; data?: any }; message?: string };

        // 部分結果がある場合はトークン枯渇等でもそこまでの取得分を返却
        if (allAsinList.length > 0) {
            const uniqueAsins = [...new Set(allAsinList)];
            res.json({
                asinList: uniqueAsins,
                totalResults,
                returnedCount: uniqueAsins.length,
                pagesRetrieved: page + 1,
                selection: parsedSelection,
                domain: parsedDomain,
                tokensLeft,
                tokensConsumed: totalTokensConsumed,
                warning: 'トークン不足のため途中までの結果を返却しています',
            });
            return;
        }

        if (err.response?.status === 429) {
            res.status(429).json({ error: 'Keepa APIレート制限。しばらく待ってから再試行してください' });
            return;
        }
        if (err.response?.status === 401 || err.response?.status === 402) {
            res.status(401).json({ error: 'Keepa API認証エラー。APIキーまたはトークンを確認してください' });
            return;
        }
        res.status(500).json({ error: `Keepaクエリ実行エラー: ${err.message || '不明なエラー'}` });
    }
});

app.post('/api/runs', (req, res) => {
    const { asins, originalCsvData } = req.body;
    if (!Array.isArray(asins) || asins.length === 0) {
        res.status(400).json({ error: 'ASINリストが必要です' });
        return;
    }

    const runId = uuidv4();
    const uniqueAsins = Array.from(new Set(asins)).filter((a: string) => a && a.trim().length > 0);

    const initialItems: ProductResult[] = uniqueAsins.map((asin: string) => ({
        asin: asin.trim(),
        title: null,
        priceAmount: null,
        priceCurrency: null,
        availability: null,
        detailUrl: null,
        fetchedAt: '',
        status: ItemStatus.PENDING,
        janCode: null,
        monthlySold: null,
    }));

    runs[runId] = {
        id: runId,
        userId: (req as any).user?.userId || 'unknown',
        createdAt: Date.now(),
        items: initialItems,
        logs: [`${uniqueAsins.length}件のASINで初期化（Keepa API使用）`],
        isRunning: true,
        queue: [...uniqueAsins],
        stats: {
            total: uniqueAsins.length,
            processed: 0,
            success: 0,
            failed: 0,
            startTime: Date.now()
        },
        originalCsvData: originalCsvData || undefined,
    };

    const sortedIds = Object.keys(runs).sort((a, b) => runs[b].createdAt - runs[a].createdAt);
    if (sortedIds.length > 5) {
        delete runs[sortedIds[sortedIds.length - 1]];
    }

    processQueue(runId);

    res.json({ runId });
});

app.get('/api/runs/:runId', async (req, res) => {
    const { runId } = req.params;
    const run = runs[runId];
    if (run) {
        res.json({
            id: run.id,
            createdAt: run.createdAt,
            items: run.items,
            logs: run.logs,
            isRunning: run.isRunning,
            stats: run.stats,
            originalCsvData: run.originalCsvData || null,
        });
        return;
    }

    // メモリにない場合はDBから読み込み
    if (pool) {
        try {
            const result = await pool.query('SELECT * FROM search_history WHERE id=$1', [runId]);
            if (result.rows.length > 0) {
                const row = result.rows[0];
                res.json({
                    id: row.id,
                    createdAt: Number(row.created_at),
                    items: row.items || [],
                    logs: [],
                    isRunning: false,
                    stats: row.stats || {},
                    originalCsvData: row.original_csv_data || null,
                });
                return;
            }
        } catch (err) { console.error('DB読み込みエラー', err); }
    }
    res.status(404).json({ error: '実行セッションが見つかりません' });
});

app.post('/api/runs/:runId/retry-failed', (req, res) => {
    const { runId } = req.params;
    const run = runs[runId];
    if (!run) {
        res.status(404).json({ error: '実行セッションが見つかりません' });
        return;
    }

    if (run.isRunning) {
        res.status(400).json({ error: '現在実行中です' });
        return;
    }

    const failedItems = run.items.filter(i =>
        i.status === ItemStatus.THROTTLED ||
        i.status === ItemStatus.ERROR ||
        i.status === ItemStatus.AUTH_ERROR
    );

    if (failedItems.length === 0) {
        res.json({ message: 'リトライ対象のアイテムがありません' });
        return;
    }

    failedItems.forEach(i => {
        i.status = ItemStatus.PENDING;
        i.errorMessage = undefined;
    });

    run.stats.failed = run.stats.failed - failedItems.length;
    run.stats.processed = run.stats.processed - failedItems.length;

    run.queue = failedItems.map(i => i.asin);
    run.isRunning = true;
    run.stats.endTime = undefined;
    run.logs.unshift(`[${new Date().toLocaleTimeString()}] ${failedItems.length}件のアイテムをリトライ中`);

    processQueue(runId);

    res.json({ message: `${failedItems.length}件のアイテムをリトライ中` });
});

app.get('/api/history', async (req, res) => {
    const userId = (req as any).user?.userId;

    // メモリ上のアクティブなrunを含める
    const memoryRuns = Object.values(runs)
        .filter(r => !userId || r.userId === userId || !pool)
        .map(r => ({
            id: r.id,
            type: 'run' as const,
            createdAt: r.createdAt,
            asinCount: r.stats.total,
            processed: r.stats.processed,
            success: r.stats.success,
            failed: r.stats.failed,
            isRunning: r.isRunning,
        }));

    // メモリ上のアクティブなcomparisonを含める
    const memoryComparisons = Object.values(comparisons)
        .filter(c => !userId || c.userId === userId || !pool)
        .map(c => ({
            id: c.id,
            type: 'comparison' as const,
            createdAt: c.createdAt,
            runId: c.runId,
            asinCount: c.stats.total,
            matched: c.stats.matched,
            profitable: c.stats.profitable,
            isRunning: c.isRunning,
        }));

    // DBからの履歴
    let dbRuns: any[] = [];
    let dbComparisons: any[] = [];
    if (pool && userId) {
        try {
            const runsResult = await pool.query(
                'SELECT id, created_at, asin_count, stats, is_running FROM search_history WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',
                [userId]
            );
            dbRuns = runsResult.rows
                .filter(r => !runs[r.id]) // メモリにあるものは除外
                .map(r => {
                    const stats = r.stats || {};
                    return {
                        id: r.id,
                        type: 'run' as const,
                        createdAt: Number(r.created_at),
                        asinCount: r.asin_count,
                        processed: stats.processed || r.asin_count,
                        success: stats.success || 0,
                        failed: stats.failed || 0,
                        isRunning: false,
                        fromDB: true,
                    };
                });

            const compResult = await pool.query(
                'SELECT id, run_id, created_at, stats, is_running FROM comparison_history WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',
                [userId]
            );
            dbComparisons = compResult.rows
                .filter(r => !comparisons[r.id])
                .map(r => {
                    const stats = r.stats || {};
                    return {
                        id: r.id,
                        type: 'comparison' as const,
                        createdAt: Number(r.created_at),
                        runId: r.run_id,
                        asinCount: stats.total || 0,
                        matched: stats.matched || 0,
                        profitable: stats.profitable || 0,
                        isRunning: false,
                        fromDB: true,
                    };
                });
        } catch (err) { console.error('DB: 履歴読み込みエラー', err); }
    }

    // 全履歴を統合してソート
    const allHistory = [...memoryRuns, ...memoryComparisons, ...dbRuns, ...dbComparisons]
        .sort((a, b) => b.createdAt - a.createdAt);

    res.json(allHistory);
});

// Keepa処理を途中で完了（処理済み結果をそのまま使う）
app.post('/api/runs/:runId/stop', (req, res) => {
    const { runId } = req.params;
    const run = runs[runId];
    if (!run) { res.status(404).json({ error: '実行セッションが見つかりません' }); return; }
    if (!run.isRunning) { res.json({ message: '既に停止しています' }); return; }
    run.isRunning = false;
    run.queue = [];
    run.stats.endTime = Date.now();
    run.logs.unshift(`[${new Date().toLocaleTimeString()}] ユーザーにより処理を停止`);
    res.json({ message: '処理を停止しました', processed: run.stats.processed, total: run.stats.total });
});

app.get('/api/status', (_req, res) => {
    res.json({
        apiConfigured: !!KEEPA_API_KEY,
        rakutenConfigured: RAKUTEN_APP_IDS.length > 0,
        rakutenAppIdCount: RAKUTEN_APP_IDS.length,
        apiType: 'Keepa',
        domain: KEEPA_DOMAIN,
        domainInfo: DOMAIN_CURRENCY_MAP[KEEPA_DOMAIN] || DOMAIN_CURRENCY_MAP[5],
    });
});

// --- 楽天比較APIルート ---

app.post('/api/compare', (req, res) => {
    const { runId } = req.body;
    if (!runId) {
        res.status(400).json({ error: 'runIdが必要です' });
        return;
    }

    const run = runs[runId];
    if (!run) {
        res.status(404).json({ error: '実行セッションが見つかりません' });
        return;
    }

    if (RAKUTEN_APP_IDS.length === 0) {
        res.status(500).json({ error: 'RAKUTEN_APP_IDが設定されていません' });
        return;
    }

    // OK ステータスの商品のみ比較対象
    const okItems = run.items.filter(i => i.status === ItemStatus.OK && i.priceAmount && i.title);

    if (okItems.length === 0) {
        res.status(400).json({ error: '比較可能な商品がありません（価格取得済みの商品が必要です）' });
        return;
    }

    const compareId = uuidv4();
    const comparisonItems: ComparisonItem[] = okItems.map(item => ({
        asin: item.asin,
        amazonTitle: item.title!,
        amazonPrice: item.priceAmount!,
        amazonUrl: item.detailUrl || `https://www.amazon.co.jp/dp/${item.asin}`,
        rakutenTitle: null,
        rakutenPrice: null,
        rakutenUrl: null,
        rakutenShop: null,
        rakutenImageUrl: null,
        rakutenPointRate: 1,
        similarityScore: 0,
        priceDiff: null,
        priceDiffPercent: null,
        estimatedFee: estimateAmazonFee(item.priceAmount!),
        estimatedProfit: null,
        profitRate: null,
        status: 'PENDING' as ComparisonStatus,
        janCode: item.janCode || null,
        monthlySold: item.monthlySold || null,
        memo: '',
        rakutenCandidates: [],
        favorite: false,
    }));

    comparisons[compareId] = {
        id: compareId,
        runId,
        userId: (req as any).user?.userId || 'unknown',
        createdAt: Date.now(),
        items: comparisonItems,
        isRunning: true,
        stats: {
            total: comparisonItems.length,
            processed: 0,
            matched: 0,
            profitable: 0,
        },
    };

    // 古い比較セッションを削除（最大5件保持）
    const sortedIds = Object.keys(comparisons).sort((a, b) => comparisons[b].createdAt - comparisons[a].createdAt);
    if (sortedIds.length > 5) {
        delete comparisons[sortedIds[sortedIds.length - 1]];
    }

    processComparisonQueue(compareId);

    res.json({ compareId });
});

// 処理途中のRunからでも即座に比較を開始（完了を待たない）
app.post('/api/compare-now', (req, res) => {
    const { runId } = req.body;
    if (!runId) { res.status(400).json({ error: 'runIdが必要です' }); return; }
    const run = runs[runId];
    if (!run) { res.status(404).json({ error: '実行セッションが見つかりません' }); return; }
    if (RAKUTEN_APP_IDS.length === 0) { res.status(500).json({ error: 'RAKUTEN_APP_IDが設定されていません' }); return; }

    // 現時点でOKの商品のみ（処理途中でもOK）
    const okItems = run.items.filter(i => i.status === ItemStatus.OK && i.priceAmount && i.title);
    if (okItems.length === 0) {
        res.status(400).json({ error: '比較可能な商品がありません（価格取得済みの商品が必要です）' });
        return;
    }

    const compareId = uuidv4();
    const comparisonItems: ComparisonItem[] = okItems.map(item => ({
        asin: item.asin,
        amazonTitle: item.title!,
        amazonPrice: item.priceAmount!,
        amazonUrl: item.detailUrl || `https://www.amazon.co.jp/dp/${item.asin}`,
        rakutenTitle: null,
        rakutenPrice: null,
        rakutenUrl: null,
        rakutenShop: null,
        rakutenImageUrl: null,
        rakutenPointRate: 1,
        similarityScore: 0,
        priceDiff: null,
        priceDiffPercent: null,
        estimatedFee: estimateAmazonFee(item.priceAmount!),
        estimatedProfit: null,
        profitRate: null,
        status: 'PENDING' as ComparisonStatus,
        janCode: item.janCode || null,
        monthlySold: item.monthlySold || null,
        memo: '',
        rakutenCandidates: [],
        favorite: false,
    }));

    comparisons[compareId] = {
        id: compareId,
        runId,
        userId: (req as any).user?.userId || 'unknown',
        createdAt: Date.now(),
        items: comparisonItems,
        isRunning: true,
        stats: { total: comparisonItems.length, processed: 0, matched: 0, profitable: 0 },
    };

    const sortedIds = Object.keys(comparisons).sort((a, b) => comparisons[b].createdAt - comparisons[a].createdAt);
    if (sortedIds.length > 5) { delete comparisons[sortedIds[sortedIds.length - 1]]; }

    processComparisonQueue(compareId);
    res.json({ compareId, itemCount: okItems.length });
});

// Keepa処理と楽天比較を同時並行で実行（ImportPageから直接ComparePageへ遷移用）
app.post('/api/auto-compare', authMiddleware, (req, res) => {
    const { runId } = req.body;
    if (!runId) { res.status(400).json({ error: 'runIdが必要です' }); return; }
    const run = runs[runId];
    if (!run) { res.status(404).json({ error: '実行セッションが見つかりません' }); return; }
    if (RAKUTEN_APP_IDS.length === 0) { res.status(500).json({ error: 'RAKUTEN_APP_IDが設定されていません' }); return; }

    const compareId = uuidv4();
    const compareUserId = (req as any).user?.userId || 'unknown';
    comparisons[compareId] = {
        id: compareId,
        runId,
        userId: compareUserId,
        createdAt: Date.now(),
        items: [],
        isRunning: true,
        stats: { total: 0, processed: 0, matched: 0, profitable: 0 },
    };

    const sortedIds = Object.keys(comparisons).sort((a, b) => comparisons[b].createdAt - comparisons[a].createdAt);
    if (sortedIds.length > 5) { delete comparisons[sortedIds[sortedIds.length - 1]]; }

    // バックグラウンドでKeepa完了アイテムを順次取り込んで楽天比較
    const processedAsins = new Set<string>();
    const watchInterval = setInterval(async () => {
        const session = comparisons[compareId];
        if (!session || !session.isRunning) { clearInterval(watchInterval); return; }

        // Keepa処理済み（OK）で未取り込みのアイテムを取得
        const newOkItems = run.items.filter(
            i => i.status === ItemStatus.OK && i.priceAmount && i.title && !processedAsins.has(i.asin)
        );

        for (const item of newOkItems) {
            processedAsins.add(item.asin);
            const compItem: ComparisonItem = {
                asin: item.asin,
                amazonTitle: item.title!,
                amazonPrice: item.priceAmount!,
                amazonUrl: item.detailUrl || `https://www.amazon.co.jp/dp/${item.asin}`,
                rakutenTitle: null, rakutenPrice: null, rakutenUrl: null,
                rakutenShop: null, rakutenImageUrl: null, rakutenPointRate: 1,
                similarityScore: 0, priceDiff: null, priceDiffPercent: null,
                estimatedFee: estimateAmazonFee(item.priceAmount!),
                estimatedProfit: null, profitRate: null,
                status: 'PENDING' as ComparisonStatus,
                janCode: item.janCode || null,
                monthlySold: item.monthlySold || null,
                memo: '', rakutenCandidates: [], favorite: false,
            };
            session.items.push(compItem);
            session.stats.total = session.items.length;
        }

        // PENDINGアイテムの楽天比較を並列ワーカーで実行
        const pendingItems = session.items.filter(i => i.status === 'PENDING');
        if (pendingItems.length > 0) {
            const workerCount = Math.min(RAKUTEN_APP_IDS.length, pendingItems.length);
            if (workerCount <= 1) {
                const appId = RAKUTEN_APP_IDS[0] || RAKUTEN_APP_ID || '';
                for (const item of pendingItems) {
                    if (!session.isRunning) break;
                    try { await processComparisonItem(item, session, appId); } catch { /* skip */ }
                    await delay(1100);
                }
            } else {
                const workerQueues: ComparisonItem[][] = Array.from({ length: workerCount }, () => []);
                pendingItems.forEach((item, idx) => { workerQueues[idx % workerCount].push(item); });
                await Promise.all(workerQueues.map(async (queue, wIdx) => {
                    const appId = RAKUTEN_APP_IDS[wIdx];
                    for (const item of queue) {
                        if (!session.isRunning) break;
                        try { await processComparisonItem(item, session, appId); } catch { /* skip */ }
                        await delay(1100);
                    }
                }));
            }
        }

        // Keepa処理が完了し、全アイテム取り込み済みなら終了
        if (!run.isRunning && newOkItems.length === 0 && pendingItems.length === 0) {
            session.isRunning = false;
            if (session.userId) saveComparisonToDB(session, session.userId);
            clearInterval(watchInterval);
        }
    }, 3000);

    res.json({ compareId });
});

// runId に紐づく最新の compareId を返す
app.get('/api/runs/:runId/compare', (req, res) => {
    const { runId } = req.params;
    // 新しい順に探す
    const found = Object.values(comparisons)
        .filter(c => c.runId === runId)
        .sort((a, b) => b.createdAt - a.createdAt);
    if (found.length > 0) {
        res.json({ compareId: found[0].id });
    } else {
        res.json({ compareId: null });
    }
});

app.get('/api/compare/:compareId', async (req, res) => {
    const { compareId } = req.params;
    const session = comparisons[compareId];
    if (session) {
        res.json(session);
        return;
    }

    // メモリにない場合はDBから読み込み
    if (pool) {
        try {
            const result = await pool.query('SELECT * FROM comparison_history WHERE id=$1', [compareId]);
            if (result.rows.length > 0) {
                const row = result.rows[0];
                res.json({
                    id: row.id,
                    runId: row.run_id,
                    createdAt: Number(row.created_at),
                    items: row.items || [],
                    isRunning: false,
                    stats: row.stats || {},
                });
                return;
            }
        } catch (err) { console.error('DB読み込みエラー', err); }
    }
    res.status(404).json({ error: '比較セッションが見つかりません' });
});

app.patch('/api/compare/:compareId/items/:asin/memo', (req, res) => {
    const { compareId, asin } = req.params;
    const { memo } = req.body;
    const session = comparisons[compareId];
    if (!session) { res.status(404).json({ error: '比較セッションが見つかりません' }); return; }
    const item = session.items.find(i => i.asin === asin);
    if (!item) { res.status(404).json({ error: '商品が見つかりません' }); return; }
    item.memo = typeof memo === 'string' ? memo.slice(0, 200) : '';
    res.json({ ok: true });
});

// 比較処理を停止
app.post('/api/compare/:compareId/stop', (req, res) => {
    const { compareId } = req.params;
    const session = comparisons[compareId];
    if (!session) { res.status(404).json({ error: '比較セッションが見つかりません' }); return; }
    if (!session.isRunning) { res.json({ message: '既に停止しています' }); return; }
    session.isRunning = false;
    res.json({ message: '比較処理を停止しました', processed: session.stats.processed, total: session.stats.total });
});

// 比較処理を再開（未処理のPENDINGアイテムを続行）
app.post('/api/compare/:compareId/resume', (req, res) => {
    const { compareId } = req.params;
    const session = comparisons[compareId];
    if (!session) { res.status(404).json({ error: '比較セッションが見つかりません' }); return; }
    if (session.isRunning) { res.status(400).json({ error: '現在処理中です' }); return; }
    const pendingCount = session.items.filter(i => i.status === 'PENDING').length;
    if (pendingCount === 0) { res.json({ message: '未処理の商品がありません' }); return; }
    session.isRunning = true;
    processComparisonQueue(compareId);
    res.json({ message: `${pendingCount}件の商品の比較を再開`, pending: pendingCount });
});

// お気に入りトグル
app.patch('/api/compare/:compareId/items/:asin/favorite', (req, res) => {
    const { compareId, asin } = req.params;
    const session = comparisons[compareId];
    if (!session) { res.status(404).json({ error: '比較セッションが見つかりません' }); return; }
    const item = session.items.find(i => i.asin === asin);
    if (!item) { res.status(404).json({ error: '商品が見つかりません' }); return; }
    item.favorite = !item.favorite;
    res.json({ ok: true, favorite: item.favorite });
});

app.post('/api/compare/:compareId/refresh', (req, res) => {
    const { compareId } = req.params;
    const session = comparisons[compareId];
    if (!session) {
        res.status(404).json({ error: '比較セッションが見つかりません' });
        return;
    }

    if (session.isRunning) {
        res.status(400).json({ error: '現在処理中です' });
        return;
    }

    // 全アイテムをPENDINGにリセット
    session.items.forEach(item => {
        item.status = 'PENDING';
        item.rakutenTitle = null;
        item.rakutenPrice = null;
        item.rakutenUrl = null;
        item.rakutenShop = null;
        item.rakutenImageUrl = null;
        item.similarityScore = 0;
        item.priceDiff = null;
        item.priceDiffPercent = null;
        item.estimatedProfit = null;
        item.profitRate = null;
        item.errorMessage = undefined;
    });

    session.stats = { total: session.items.length, processed: 0, matched: 0, profitable: 0 };
    session.isRunning = true;

    processComparisonQueue(compareId);

    res.json({ message: '楽天価格を再取得中' });
});

// --- フロントエンド配信（本番環境） ---
if (process.env.NODE_ENV !== 'development') {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
        res.sendFile(path.join(__dirname, 'dist/index.html'));
    });
}

app.listen(PORT, () => {
    console.log(`サーバー起動: ポート ${PORT}`);
    console.log(`Keepa API: (ドメイン: ${KEEPA_DOMAIN}) ${KEEPA_API_KEY ? '✓ 設定済み' : '✗ 未設定'}`);
    console.log(`楽天API: AppID×${RAKUTEN_APP_IDS.length}個 AccessKey=${RAKUTEN_ACCESS_KEY ? '✓' : '✗'} → ${RAKUTEN_APP_IDS.length}req/秒`);
});
