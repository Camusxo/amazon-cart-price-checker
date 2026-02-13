import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

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
    salesRankDrops30?: number;   // 30日間の売上ランク降下数 ≒ 月間販売個数
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
const JWT_SECRET = process.env.JWT_SECRET || 'price-checker-secret-key-change-in-production';
const ADMIN_ID = process.env.ADMIN_ID || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// --- 認証関連 ---
type UserRole = 'admin' | 'member';

interface User {
    id: string;
    username: string;
    passwordHash: string;
    role: UserRole;
    createdAt: number;
}

// インメモリユーザーストア
const users: Record<string, User> = {};

// 管理者アカウント初期化
const initAdmin = async () => {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    users['admin'] = {
        id: 'admin',
        username: ADMIN_ID,
        passwordHash: hash,
        role: 'admin',
        createdAt: Date.now(),
    };
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

const fetchFromKeepa = async (asins: string[], runId: string): Promise<ProductResult[]> => {
    if (!KEEPA_API_KEY) {
        throw new Error("KEEPA_API_KEY が設定されていません。.envファイルを確認してください。");
    }

    const domainInfo = DOMAIN_CURRENCY_MAP[KEEPA_DOMAIN] || DOMAIN_CURRENCY_MAP[5];

    try {
        const response = await axios.get<KeepaApiResponse>('https://api.keepa.com/product', {
            params: {
                key: KEEPA_API_KEY,
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
                    monthlySold: product.salesRankDrops30 || null,
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

    while (attempts < maxAttempts && !success) {
        try {
            log(runId, `${asinsToFetch.length}件のアイテムを取得中...（試行 ${attempts + 1}）`);
            const fetchedItems = await fetchFromKeepa(asinsToFetch, runId);

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
                log(runId, `認証エラー: ${err.message}`);
                asinsToFetch.forEach(asin => {
                    const idx = run.items.findIndex(i => i.asin === asin);
                    if (idx !== -1) {
                        run.items[idx].status = ItemStatus.AUTH_ERROR;
                        run.items[idx].errorMessage = 'Keepa API認証エラー。APIキーまたはトークン残量を確認してください。';
                    }
                });
                run.stats.processed += asinsToFetch.length;
                run.stats.failed += asinsToFetch.length;
                break;
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

const searchRakuten = async (keyword: string): Promise<RakutenProduct[]> => {
    if (!RAKUTEN_APP_ID) {
        throw new Error('RAKUTEN_APP_ID が設定されていません。');
    }

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
            applicationId: RAKUTEN_APP_ID!,
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

const calculateSimilarity = (str1: string, str2: string): number => {
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

// Amazon手数料概算（カテゴリ問わず15%）
const estimateAmazonFee = (price: number): number => {
    return Math.round(price * 0.15);
};

// 比較キュー処理
const processComparisonQueue = async (compareId: string): Promise<void> => {
    const session = comparisons[compareId];
    if (!session || !session.isRunning) return;

    const pendingItems = session.items.filter(i => i.status === 'PENDING');
    if (pendingItems.length === 0) {
        session.isRunning = false;
        return;
    }

    for (const item of pendingItems) {
        if (!session.isRunning) break;

        try {
            const rakutenResults = await searchRakuten(item.amazonTitle);

            if (rakutenResults.length === 0) {
                item.status = 'NO_MATCH';
                item.rakutenTitle = null;
                item.rakutenPrice = null;
                item.rakutenCandidates = [];
                session.stats.processed++;
                await delay(1100); // レート制限対応
                continue;
            }

            // 全結果の類似度を計算してソート
            const scoredResults = rakutenResults
                .map(rp => ({
                    ...rp,
                    score: calculateSimilarity(item.amazonTitle, rp.itemName)
                }))
                .sort((a, b) => b.score - a.score)
                .filter(r => r.score >= 0.3)  // 類似度30%以上のみ候補
                .slice(0, 3);  // 上位3件

            // 候補を格納
            item.rakutenCandidates = scoredResults.map(r => ({
                title: r.itemName,
                price: r.itemPrice,
                url: r.itemUrl,
                shopName: r.shopName,
                imageUrl: r.imageUrl || '',
                pointRate: r.pointRate || 1,
                similarityScore: r.score,
            }));

            // ベストマッチ（既存ロジック - 0.7以上でMATCHED）
            const bestMatch = scoredResults[0] || null;
            const bestScore = bestMatch?.score || 0;

            // 類似度閾値（0.7以上でマッチ判定）
            if (bestMatch && bestScore >= 0.7) {
                item.status = 'MATCHED';
                item.rakutenTitle = bestMatch.itemName;
                item.rakutenPrice = bestMatch.itemPrice;
                item.rakutenUrl = bestMatch.itemUrl;
                item.rakutenShop = bestMatch.shopName;
                item.rakutenImageUrl = bestMatch.imageUrl;
                item.rakutenPointRate = bestMatch.pointRate;
                item.similarityScore = bestScore;

                // 価格差計算
                item.priceDiff = item.amazonPrice - bestMatch.itemPrice;
                item.priceDiffPercent = Math.round(((item.amazonPrice - bestMatch.itemPrice) / item.amazonPrice) * 100 * 10) / 10;

                // 利益計算: Amazon販売価格 - 楽天仕入価格 - Amazon手数料
                item.estimatedFee = estimateAmazonFee(item.amazonPrice);
                item.estimatedProfit = item.amazonPrice - bestMatch.itemPrice - item.estimatedFee;
                item.profitRate = Math.round((item.estimatedProfit / item.amazonPrice) * 100 * 10) / 10;

                session.stats.matched++;
                if (item.estimatedProfit > 0) {
                    session.stats.profitable++;
                }
            } else {
                item.status = 'NO_MATCH';
                // 類似度が低くても最安値の楽天商品を参考表示
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
                // レート制限時は3秒待って再試行
                await delay(3000);
                continue;
            }
            item.status = 'ERROR';
            item.errorMessage = err.message || '楽天API検索エラー';
            session.stats.processed++;
        }

        // 楽天API レート制限: 1リクエスト/秒
        await delay(1100);
    }

    session.isRunning = false;
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
    users[id] = { id, username, passwordHash: hash, role: validRole, createdAt: Date.now() };
    res.json({ id, username, role: validRole });
});

// 管理者: ユーザー削除
app.delete('/api/admin/users/:userId', authMiddleware, adminOnly, (req, res) => {
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
    if (!KEEPA_API_KEY) {
        res.status(500).json({ error: 'KEEPA_API_KEYが設定されていません' });
        return;
    }

    try {
        const response = await axios.get<KeepaApiResponse>('https://api.keepa.com/search', {
            params: {
                key: KEEPA_API_KEY,
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
            monthlySold: p.salesRankDrops30 || null,
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

app.get('/api/runs/:runId', (req, res) => {
    const { runId } = req.params;
    const run = runs[runId];
    if (!run) {
        res.status(404).json({ error: '実行セッションが見つかりません' });
        return;
    }

    res.json({
        id: run.id,
        createdAt: run.createdAt,
        items: run.items,
        logs: run.logs,
        isRunning: run.isRunning,
        stats: run.stats,
        originalCsvData: run.originalCsvData || null,
    });
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

app.get('/api/history', (_req, res) => {
    const history = Object.values(runs)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(r => ({
            id: r.id,
            createdAt: r.createdAt,
            total: r.stats.total,
            processed: r.stats.processed
        }));
    res.json(history);
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
        rakutenConfigured: !!RAKUTEN_APP_ID,
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

    if (!RAKUTEN_APP_ID) {
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
    if (!RAKUTEN_APP_ID) { res.status(500).json({ error: 'RAKUTEN_APP_IDが設定されていません' }); return; }

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

app.get('/api/compare/:compareId', (req, res) => {
    const { compareId } = req.params;
    const session = comparisons[compareId];
    if (!session) {
        res.status(404).json({ error: '比較セッションが見つかりません' });
        return;
    }
    res.json(session);
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
    console.log(`楽天API: AppID=${RAKUTEN_APP_ID ? '✓' : '✗'} AccessKey=${RAKUTEN_ACCESS_KEY ? '✓' : '✗'}`);
});
