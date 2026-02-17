import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import Papa from 'papaparse';
import {
    Download,
    RefreshCw,
    Search,
    ChevronDown,
    ChevronUp,
    FileSpreadsheet,
    FilePlus,
    GitCompareArrows,
    Loader2,
    Square,
    ArrowRightLeft,
    Copy,
    Check,
} from 'lucide-react';
import { RunSession, ItemStatus, OriginalCsvData } from '../types';
import { getStatusColor, formatCurrency } from '../lib/utils';

interface ExtendedRunSession extends RunSession {
    originalCsvData?: OriginalCsvData | null;
}

const RunPage: React.FC = () => {
    const { runId } = useParams();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const autoCompare = searchParams.get('autoCompare') === 'true';
    const [data, setData] = useState<ExtendedRunSession | null>(null);
    const [filterStatus, setFilterStatus] = useState<string>('ALL');
    const [search, setSearch] = useState('');
    const [showLogs, setShowLogs] = useState(false);
    const [loading, setLoading] = useState(true);
    const [startingCompare, setStartingCompare] = useState(false);
    const [autoCompareTriggered, setAutoCompareTriggered] = useState(false);
    const [linkedCompareId, setLinkedCompareId] = useState<string | null>(null);
    const [tokenInfo, setTokenInfo] = useState<{ tokensLeft: number; estimatedAsins: number; refillRate: number } | null>(null);

    const fetchData = async () => {
        try {
            const res = await axios.get(`/api/runs/${runId}`);
            setData(res.data);
            setLoading(false);
        } catch (e) {
            console.error("実行データの取得に失敗しました", e);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(() => {
            if (data?.isRunning) {
                fetchData();
            }
        }, 2000);
        return () => clearInterval(interval);
    }, [runId, data?.isRunning]);

    // 紐づく比較セッションを取得
    useEffect(() => {
        if (!runId) return;
        axios.get(`/api/runs/${runId}/compare`).then(res => {
            setLinkedCompareId(res.data.compareId || null);
        }).catch(() => {});
    }, [runId, startingCompare]);

    // Keepaトークン残量
    useEffect(() => {
        axios.get('/api/keepa-tokens').then(res => setTokenInfo(res.data)).catch(() => {});
    }, []);

    // autoCompare=true の場合、Keepa処理が全件完了してから楽天比較を開始
    useEffect(() => {
        if (autoCompare && !autoCompareTriggered && data && !startingCompare) {
            // Keepa処理が完了し、成功件数が1件以上の場合に自動開始
            if (!data.isRunning && data.stats.success >= 1) {
                setAutoCompareTriggered(true);
                handleStartCompareNow();
            }
        }
    }, [autoCompare, autoCompareTriggered, data, startingCompare]);

    const handleRetry = async () => {
        if (!runId) return;
        try {
            await axios.post(`/api/runs/${runId}/retry-failed`);
            fetchData();
        } catch {
            alert("リトライに失敗しました");
        }
    };

    const handleStartCompare = async () => {
        if (!runId) return;
        setStartingCompare(true);
        try {
            const res = await axios.post('/api/compare', { runId });
            navigate(`/compare/${res.data.compareId}`);
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: string } } };
            alert(error.response?.data?.error || '楽天比較の開始に失敗しました');
            setStartingCompare(false);
        }
    };

    const handleStopRun = async () => {
        if (!runId) return;
        try {
            await axios.post(`/api/runs/${runId}/stop`);
            fetchData();
        } catch {
            alert('停止に失敗しました');
        }
    };

    const handleStartCompareNow = async () => {
        if (!runId) return;
        setStartingCompare(true);
        try {
            const res = await axios.post('/api/compare-now', { runId });
            navigate(`/compare/${res.data.compareId}`);
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: string } } };
            alert(error.response?.data?.error || '楽天比較の開始に失敗しました');
            setStartingCompare(false);
        }
    };

    const handleDownloadStandard = () => {
        if (!data) return;
        const csv = Papa.unparse(data.items.map(i => ({
            ASIN: i.asin,
            商品名: i.title || '',
            価格: i.priceAmount,
            通貨: i.priceCurrency,
            ステータス: i.status,
            URL: i.detailUrl,
            取得日時: i.fetchedAt,
            エラー: i.errorMessage || ''
        })));

        const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
        const blob = new Blob([bom, csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `amazon_prices_${new Date().toISOString().slice(0,10)}.csv`;
        link.click();
    };

    const handleDownloadMerged = () => {
        if (!data || !data.originalCsvData) return;

        const { headers, priceColumn, rows } = data.originalCsvData;

        const priceMap = new Map<string, { price: number | null; title: string | null; status: string }>();
        data.items.forEach(item => {
            priceMap.set(item.asin, {
                price: item.priceAmount,
                title: item.title,
                status: item.status,
            });
        });

        const newHeaders = [...headers];
        const priceColName = priceColumn || '想定販売価格';
        const statusColName = '取得ステータス';
        const titleColName = 'Amazon商品名';

        if (!headers.includes(priceColName)) {
            newHeaders.push(priceColName);
        }
        if (!headers.includes(statusColName)) {
            newHeaders.push(statusColName);
        }
        if (!headers.includes(titleColName)) {
            newHeaders.push(titleColName);
        }

        const mergedRows = rows.map(row => {
            const newRow: Record<string, string> = { ...row.originalRow };
            const priceInfo = priceMap.get(row.asin);

            if (priceInfo) {
                newRow[priceColName] = priceInfo.price !== null ? String(priceInfo.price) : '';
                newRow[statusColName] = priceInfo.status;
                newRow[titleColName] = priceInfo.title || '';
            }

            return newRow;
        });

        const csv = Papa.unparse({
            fields: newHeaders,
            data: mergedRows,
        });

        const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
        const blob = new Blob([bom, csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `amazon_prices_merged_${new Date().toISOString().slice(0,10)}.csv`;
        link.click();
    };

    const filteredItems = useMemo(() => {
        if (!data) return [];
        return data.items.filter(item => {
            const matchesStatus = filterStatus === 'ALL' || item.status === filterStatus;
            const matchesSearch = search === '' ||
                item.asin.toLowerCase().includes(search.toLowerCase()) ||
                (item.title && item.title.toLowerCase().includes(search.toLowerCase()));
            return matchesStatus && matchesSearch;
        });
    }, [data, filterStatus, search]);

    if (loading && !data) {
        return (
            <div className="flex justify-center p-20">
                <div className="animate-spin h-8 w-8 border-4 border-amazon-orange rounded-full border-t-transparent"></div>
            </div>
        );
    }

    if (!data) {
        return <div className="p-10 text-center text-red-500">実行セッションが見つかりません</div>;
    }

    const progress = Math.round((data.stats.processed / data.stats.total) * 100) || 0;
    const hasOriginalCsv = !!data.originalCsvData;

    return (
        <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800">
                            実行状態:
                            <span className={`ml-2 ${data.isRunning ? 'text-blue-600' : 'text-green-600'}`}>
                                {data.isRunning ? '処理中...' : '完了'}
                            </span>
                        </h2>
                        <div className="text-sm text-slate-500 mt-1 space-x-4">
                            <span>ID: {data.id.slice(0, 8)}...</span>
                            <span>開始: {new Date(data.stats.startTime).toLocaleString()}</span>
                            {data.stats.endTime && <span>終了: {new Date(data.stats.endTime).toLocaleString()}</span>}
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {/* 処理中の制御ボタン */}
                        {data.isRunning && (
                            <>
                                <button onClick={handleStopRun}
                                    className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-red-500 hover:bg-red-600 rounded-md transition-colors">
                                    <Square className="w-4 h-4" /> 処理を完了
                                </button>
                                <button onClick={handleStartCompareNow} disabled={startingCompare}
                                    className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors disabled:opacity-50">
                                    {startingCompare ? (
                                        <><Loader2 className="w-4 h-4 animate-spin" /> 開始中...</>
                                    ) : (
                                        <><GitCompareArrows className="w-4 h-4" /> 途中で楽天比較を開始</>
                                    )}
                                </button>
                            </>
                        )}
                        {/* 完了後のナビゲーションボタン */}
                        {!data.isRunning && data.stats.success > 0 && (
                            <button onClick={handleStartCompare} disabled={startingCompare}
                                className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors disabled:opacity-50">
                                {startingCompare ? (
                                    <><Loader2 className="w-4 h-4 animate-spin" /> 開始中...</>
                                ) : (
                                    <><GitCompareArrows className="w-4 h-4" /> 楽天比較を開始</>
                                )}
                            </button>
                        )}
                        {linkedCompareId && (
                            <button onClick={() => navigate(`/compare/${linkedCompareId}`)}
                                className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-rose-500 hover:bg-rose-600 rounded-md transition-colors">
                                <ArrowRightLeft className="w-4 h-4" /> 比較結果を見る
                            </button>
                        )}
                        {data.stats.failed > 0 && !data.isRunning && (
                            <button onClick={handleRetry}
                                className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-amazon-orange hover:bg-yellow-500 rounded-md transition-colors">
                                <RefreshCw className="w-4 h-4" /> 失敗分リトライ ({data.stats.failed})
                            </button>
                        )}
                        <button onClick={handleDownloadStandard}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors">
                            <Download className="w-4 h-4" /> CSVエクスポート
                        </button>
                        {hasOriginalCsv && (
                            <button onClick={handleDownloadMerged}
                                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md transition-colors">
                                <FilePlus className="w-4 h-4" /> 元CSVに価格追加
                            </button>
                        )}
                    </div>
                </div>

                {autoCompare && !autoCompareTriggered && (
                    <div className="bg-indigo-50 border border-indigo-200 text-indigo-700 p-4 rounded-lg flex items-center gap-3 mb-4">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span className="font-medium">Keepa処理完了後、自動的に楽天比較を開始します...</span>
                    </div>
                )}

                {autoCompare && autoCompareTriggered && (
                    <div className="bg-indigo-50 border border-indigo-200 text-indigo-700 p-4 rounded-lg flex items-center gap-3 mb-4">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span className="font-medium">楽天比較を開始しています。まもなく比較ページに遷移します...</span>
                    </div>
                )}

                {hasOriginalCsv && (
                    <div className="bg-green-50 border border-green-100 rounded-lg p-3 mb-4">
                        <div className="flex items-center gap-2 text-green-700 text-sm">
                            <FileSpreadsheet className="w-4 h-4" />
                            <span>
                                <strong>元CSVに価格追加:</strong> 元のCSV構造を保持したまま「想定販売価格」列に取得価格を反映します
                            </span>
                        </div>
                    </div>
                )}

                <div className="relative h-4 bg-slate-100 rounded-full overflow-hidden">
                    <div
                        className="absolute top-0 left-0 h-full bg-blue-500 transition-all duration-500 ease-out"
                        style={{ width: `${progress}%` }}
                    />
                </div>
                <div className="flex justify-between text-xs font-medium text-slate-500 mt-2">
                    <span>処理済み: {data.stats.processed} / {data.stats.total}</span>
                    <span>{progress}%</span>
                </div>

                <div className="grid grid-cols-4 gap-4 mt-6">
                    <div className="bg-green-50 p-3 rounded-lg border border-green-100 text-center">
                        <div className="text-2xl font-bold text-green-700">{data.stats.success}</div>
                        <div className="text-xs text-green-600 font-medium">成功</div>
                    </div>
                    <div className="bg-red-50 p-3 rounded-lg border border-red-100 text-center">
                        <div className="text-2xl font-bold text-red-700">{data.stats.failed}</div>
                        <div className="text-xs text-red-600 font-medium">失敗</div>
                    </div>
                    <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 text-center">
                        <div className="text-2xl font-bold text-blue-700">{data.stats.total}</div>
                        <div className="text-xs text-blue-600 font-medium">合計</div>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-center">
                        <div className="text-2xl font-bold text-slate-700">
                            {data.stats.total - data.stats.processed}
                        </div>
                        <div className="text-xs text-slate-600 font-medium">待機中</div>
                    </div>
                </div>

                {/* Keepaトークン残量 */}
                {tokenInfo && (
                    <div className="mt-4 flex items-center gap-4 text-xs bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
                        <span className="text-slate-500">Keepaトークン残量:</span>
                        <span className={`font-bold ${tokenInfo.tokensLeft < 100 ? 'text-red-600' : tokenInfo.tokensLeft < 500 ? 'text-amber-600' : 'text-green-600'}`}>
                            {tokenInfo.tokensLeft.toLocaleString()}
                        </span>
                        <span className="text-slate-400">|</span>
                        <span className="text-slate-500">追加検索可能: 約<strong className="text-slate-700">{tokenInfo.estimatedAsins.toLocaleString()}</strong>件</span>
                        <span className="text-slate-400">|</span>
                        <span className="text-slate-500">回復速度: <strong className="text-slate-700">{tokenInfo.refillRate}</strong>/分</span>
                    </div>
                )}

                <div className="mt-4 border-t pt-4">
                    <button
                        onClick={() => setShowLogs(!showLogs)}
                        className="flex items-center text-sm text-slate-500 hover:text-slate-700 font-medium"
                    >
                        {showLogs ? <ChevronUp className="w-4 h-4 mr-1"/> : <ChevronDown className="w-4 h-4 mr-1"/>}
                        {showLogs ? 'ログを隠す' : '最近のログを表示'}
                    </button>
                    {showLogs && (
                        <div className="mt-2 bg-slate-900 text-slate-300 p-4 rounded-md font-mono text-xs h-40 overflow-y-auto">
                            {data.logs.map((log, i) => (
                                <div key={i}>{log}</div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex flex-col md:flex-row gap-4">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                        type="text"
                        placeholder="ASINまたは商品名で検索..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amazon-blue focus:border-transparent outline-none"
                    />
                </div>
                <select
                    value={filterStatus}
                    onChange={e => setFilterStatus(e.target.value)}
                    className="px-4 py-2 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-amazon-blue outline-none"
                >
                    <option value="ALL">すべてのステータス</option>
                    {Object.values(ItemStatus).map(s => (
                        <option key={s} value={s}>{s}</option>
                    ))}
                </select>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                            <tr>
                                <th className="px-6 py-4 font-semibold">ASIN / 商品名</th>
                                <th className="px-6 py-4 font-semibold">価格</th>
                                <th className="px-6 py-4 font-semibold">月間販売数</th>
                                <th className="px-6 py-4 font-semibold">ステータス</th>
                                <th className="px-6 py-4 font-semibold">詳細</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredItems.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="p-8 text-center text-slate-400">
                                        フィルター条件に一致するアイテムがありません。
                                    </td>
                                </tr>
                            ) : (
                                filteredItems.map((item) => (
                                    <tr key={item.asin} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-6 py-4 max-w-md">
                                            <div className="font-mono text-[11px] font-bold text-indigo-700 flex items-center">
                                                {item.asin}<CopyButton text={item.asin} />
                                            </div>
                                            {item.janCode && (
                                                <div className="font-mono text-[11px] font-bold text-emerald-700 flex items-center">
                                                    JAN: {item.janCode}<CopyButton text={item.janCode} />
                                                </div>
                                            )}
                                            {item.title ? (
                                                <div className="text-slate-600 line-clamp-2 text-sm mt-0.5" title={item.title}>{item.title}</div>
                                            ) : (
                                                <span className="text-slate-300 italic text-sm">タイトルなし</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="font-medium text-lg text-slate-800">
                                                {formatCurrency(item.priceAmount, item.priceCurrency)}
                                            </div>
                                            {item.availability && (
                                                <div className="text-xs text-green-600">{item.availability}</div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            {item.monthlySold !== null && item.monthlySold > 0 ? (
                                                <div className="inline-flex items-center px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg">
                                                    <span className="text-lg font-bold">{item.monthlySold}</span>
                                                    <span className="text-xs ml-1">個/月</span>
                                                </div>
                                            ) : (
                                                <span className="text-slate-300 text-xs">---</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(item.status)}`}>
                                                {item.status}
                                            </span>
                                            {item.errorMessage && (
                                                <div className="text-xs text-red-500 mt-1 max-w-[200px] truncate" title={item.errorMessage}>
                                                    {item.errorMessage}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            {item.detailUrl && (
                                                <a
                                                    href={item.detailUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-amazon-blue hover:underline"
                                                >
                                                    Amazonで見る
                                                </a>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = React.useState(false);
    const handleCopy = (e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    };
    return (
        <button onClick={handleCopy} className="inline-flex items-center ml-1 p-0.5 rounded hover:bg-slate-200 transition-colors" title={`${text} をコピー`}>
            {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-slate-400 hover:text-slate-600" />}
        </button>
    );
}

export default RunPage;
