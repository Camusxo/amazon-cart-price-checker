import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';

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
                stats: 1,
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

        const response = await axios.get('https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601', {
            params,
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
                session.stats.processed++;
                await delay(1100); // レート制限対応
                continue;
            }

            // 最も類似度が高い商品を選択
            let bestMatch: RakutenProduct | null = null;
            let bestScore = 0;

            for (const rp of rakutenResults) {
                const score = calculateSimilarity(item.amazonTitle, rp.itemName);
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = rp;
                }
            }

            // 類似度閾値（0.2以上でマッチ判定）
            if (bestMatch && bestScore >= 0.2) {
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
        status: ItemStatus.PENDING
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

app.get('/api/status', (_req, res) => {
    res.json({
        apiConfigured: !!KEEPA_API_KEY,
        rakutenConfigured: !!RAKUTEN_APP_ID,
        apiType: 'Keepa',
        domain: KEEPA_DOMAIN,
        domainInfo: DOMAIN_CURRENCY_MAP[KEEPA_DOMAIN] || DOMAIN_CURRENCY_MAP[5],
    });
});

// --- 楽天APIテスト ---
app.get('/api/rakuten-test', async (_req, res) => {
    try {
        const testKeyword = 'エンポリオ アルマーニ 腕時計';
        const params: Record<string, string | number> = {
            applicationId: RAKUTEN_APP_ID || '',
            keyword: testKeyword,
            hits: 3,
            formatVersion: 2,
        };
        if (RAKUTEN_ACCESS_KEY) {
            params.accessKey = RAKUTEN_ACCESS_KEY;
        }

        console.log('Rakuten test params:', JSON.stringify(params));

        // 旧エンドポイント
        try {
            const res1 = await axios.get('https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601', {
                params, timeout: 10000,
            });
            res.json({ endpoint: 'old', status: 'OK', count: res1.data.Items?.length || 0, firstItem: res1.data.Items?.[0]?.itemName || null });
            return;
        } catch (e: unknown) {
            const err = e as { response?: { status: number; data?: unknown } };
            console.log('Old endpoint error:', err.response?.status, JSON.stringify(err.response?.data));

            // 旧エンドポイントが失敗した場合、新エンドポイントを試す
            try {
                const res2 = await axios.get('https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601', {
                    params, timeout: 10000,
                });
                res.json({ endpoint: 'new', status: 'OK', count: res2.data.Items?.length || 0, firstItem: res2.data.Items?.[0]?.itemName || null });
                return;
            } catch (e2: unknown) {
                const err2 = e2 as { response?: { status: number; data?: unknown } };
                res.json({
                    old: { status: err.response?.status, data: err.response?.data },
                    new: { status: err2.response?.status, data: err2.response?.data },
                    params: { ...params, applicationId: params.applicationId ? '***SET***' : '***MISSING***', accessKey: params.accessKey ? '***SET***' : '***MISSING***' },
                });
            }
        }
    } catch (error: unknown) {
        const err = error as { message?: string };
        res.status(500).json({ error: err.message });
    }
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

app.get('/api/compare/:compareId', (req, res) => {
    const { compareId } = req.params;
    const session = comparisons[compareId];
    if (!session) {
        res.status(404).json({ error: '比較セッションが見つかりません' });
        return;
    }
    res.json(session);
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
