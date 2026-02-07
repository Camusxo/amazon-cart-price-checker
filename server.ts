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

// --- 状態管理（インメモリ） ---
const runs: Record<string, RunSession> = {};
const itemCache: Record<string, { data: ProductResult; expiresAt: number }> = {};

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
        apiType: 'Keepa',
        domain: KEEPA_DOMAIN,
        domainInfo: DOMAIN_CURRENCY_MAP[KEEPA_DOMAIN] || DOMAIN_CURRENCY_MAP[5],
    });
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
    console.log(`API: Keepa (ドメイン: ${KEEPA_DOMAIN})`);
    console.log(`APIキー設定: ${KEEPA_API_KEY ? '✓ 設定済み' : '✗ 未設定'}`);
});
