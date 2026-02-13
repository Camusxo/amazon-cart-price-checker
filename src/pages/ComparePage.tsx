import React, { useEffect, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import Papa from 'papaparse';
import {
    Download,
    RefreshCw,
    Search,
    ExternalLink,
    TrendingUp,
    TrendingDown,
    Filter,
    ChevronLeft,
    ChevronRight,
    Eye,
    X,
} from 'lucide-react';
import { ComparisonSession, ComparisonItem } from '../types';
import { formatCurrency } from '../lib/utils';

const ComparePage: React.FC = () => {
    const { compareId } = useParams();
    const [data, setData] = useState<ComparisonSession | null>(null);
    const [loading, setLoading] = useState(true);

    // フィルター状態
    const [keyword, setKeyword] = useState('');
    const [minProfit, setMinProfit] = useState<string>('');
    const [minProfitRate, setMinProfitRate] = useState<string>('');
    const [minPrice, setMinPrice] = useState<string>('');
    const [maxPrice, setMaxPrice] = useState<string>('');
    const [statusFilter, setStatusFilter] = useState<string>('ALL');
    const [showFilterPanel, setShowFilterPanel] = useState(false);

    // ページネーション
    const [pageSize, setPageSize] = useState(50);
    const [currentPage, setCurrentPage] = useState(1);

    // ソート
    const [sortKey, setSortKey] = useState<string>('profitRate');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    // プレビュー
    const [previewItem, setPreviewItem] = useState<ComparisonItem | null>(null);

    const fetchData = async () => {
        try {
            const res = await axios.get(`/api/compare/${compareId}`);
            setData(res.data);
            setLoading(false);
        } catch {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(() => {
            if (data?.isRunning) fetchData();
        }, 2000);
        return () => clearInterval(interval);
    }, [compareId, data?.isRunning]);

    const handleRefresh = async () => {
        if (!compareId) return;
        try {
            await axios.post(`/api/compare/${compareId}/refresh`);
            fetchData();
        } catch {
            alert('再取得に失敗しました');
        }
    };

    // ショートカットプリセット
    const applyPreset = (preset: string) => {
        setKeyword('');
        setMinPrice('');
        setMaxPrice('');
        setStatusFilter('ALL');
        setCurrentPage(1);

        switch (preset) {
            case 'profit1000':
                setMinProfit('1000');
                setMinProfitRate('');
                break;
            case 'rate10':
                setMinProfit('');
                setMinProfitRate('10');
                break;
            case 'rate20':
                setMinProfit('');
                setMinProfitRate('20');
                break;
            case 'rakuten_cheap':
                setMinProfit('');
                setMinProfitRate('');
                setStatusFilter('MATCHED');
                break;
            case 'all':
                setMinProfit('');
                setMinProfitRate('');
                break;
        }
    };

    // フィルタリング
    const filteredItems = useMemo(() => {
        if (!data) return [];
        return data.items.filter(item => {
            if (keyword) {
                const kw = keyword.toLowerCase();
                const matchTitle = item.amazonTitle.toLowerCase().includes(kw) ||
                    (item.rakutenTitle && item.rakutenTitle.toLowerCase().includes(kw));
                const matchAsin = item.asin.toLowerCase().includes(kw);
                const matchShop = item.rakutenShop && item.rakutenShop.toLowerCase().includes(kw);
                if (!matchTitle && !matchAsin && !matchShop) return false;
            }
            if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;
            if (minProfit && (item.estimatedProfit === null || item.estimatedProfit < Number(minProfit))) return false;
            if (minProfitRate && (item.profitRate === null || item.profitRate < Number(minProfitRate))) return false;
            if (minPrice && item.amazonPrice < Number(minPrice)) return false;
            if (maxPrice && item.amazonPrice > Number(maxPrice)) return false;
            return true;
        });
    }, [data, keyword, statusFilter, minProfit, minProfitRate, minPrice, maxPrice]);

    // ソート
    const sortedItems = useMemo(() => {
        const items = [...filteredItems];
        items.sort((a, b) => {
            let valA: number | null = null;
            let valB: number | null = null;
            switch (sortKey) {
                case 'profitRate': valA = a.profitRate; valB = b.profitRate; break;
                case 'profit': valA = a.estimatedProfit; valB = b.estimatedProfit; break;
                case 'amazonPrice': valA = a.amazonPrice; valB = b.amazonPrice; break;
                case 'rakutenPrice': valA = a.rakutenPrice; valB = b.rakutenPrice; break;
                case 'similarity': valA = a.similarityScore; valB = b.similarityScore; break;
                default: valA = a.profitRate; valB = b.profitRate;
            }
            if (valA === null && valB === null) return 0;
            if (valA === null) return 1;
            if (valB === null) return -1;
            return sortDir === 'desc' ? valB - valA : valA - valB;
        });
        return items;
    }, [filteredItems, sortKey, sortDir]);

    // ページネーション計算
    const totalPages = Math.ceil(sortedItems.length / pageSize);
    const paginatedItems = sortedItems.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    const handleSort = (key: string) => {
        if (sortKey === key) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir('desc');
        }
    };

    const handleExportCSV = () => {
        if (!data) return;
        const csv = Papa.unparse(sortedItems.map(i => ({
            ASIN: i.asin,
            'Amazon商品名': i.amazonTitle,
            'Amazon価格': i.amazonPrice,
            '楽天商品名': i.rakutenTitle || '',
            '楽天価格': i.rakutenPrice || '',
            '楽天店舗': i.rakutenShop || '',
            '価格差': i.priceDiff || '',
            '価格差%': i.priceDiffPercent !== null ? `${i.priceDiffPercent}%` : '',
            'Amazon手数料': i.estimatedFee,
            '推定利益': i.estimatedProfit || '',
            '利益率': i.profitRate !== null ? `${i.profitRate}%` : '',
            '類似度': Math.round(i.similarityScore * 100) + '%',
            'ステータス': i.status,
            'Amazon URL': i.amazonUrl,
            '楽天URL': i.rakutenUrl || '',
        })));
        const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
        const blob = new Blob([bom, csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `price_comparison_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
    };

    if (loading && !data) {
        return (
            <div className="flex justify-center p-20">
                <div className="animate-spin h-8 w-8 border-4 border-indigo-500 rounded-full border-t-transparent" />
            </div>
        );
    }

    if (!data) {
        return <div className="p-10 text-center text-red-500">比較セッションが見つかりません</div>;
    }

    const progress = data.stats.total > 0 ? Math.round((data.stats.processed / data.stats.total) * 100) : 0;

    return (
        <div className="space-y-5">
            {/* ヘッダー + 進捗 */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                            <span className="text-indigo-600">Amazon</span>
                            <span className="text-slate-400">vs</span>
                            <span className="text-rose-500">楽天</span>
                            <span className="text-slate-700 ml-1">価格比較</span>
                        </h2>
                        <p className="text-sm text-slate-500 mt-1">
                            {data.isRunning ? '楽天商品を検索中...' : '比較完了'}
                            {' '}| ID: {data.id.slice(0, 8)}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {!data.isRunning && (
                            <button onClick={handleRefresh} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors border border-indigo-200">
                                <RefreshCw className="w-4 h-4" /> 再取得
                            </button>
                        )}
                        <button onClick={handleExportCSV} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 rounded-lg transition-colors border border-slate-300">
                            <Download className="w-4 h-4" /> CSV出力
                        </button>
                    </div>
                </div>

                {/* プログレスバー */}
                <div className="relative h-3 bg-slate-100 rounded-full overflow-hidden">
                    <div className="absolute top-0 left-0 h-full bg-gradient-to-r from-indigo-500 to-rose-500 transition-all duration-500" style={{ width: `${progress}%` }} />
                </div>
                <div className="flex justify-between text-xs text-slate-500 mt-1.5">
                    <span>{data.stats.processed} / {data.stats.total} 処理済み</span>
                    <span>{progress}%</span>
                </div>

                {/* 統計カード */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
                    <StatCard label="合計" value={data.stats.total} color="slate" />
                    <StatCard label="マッチ" value={data.stats.matched} color="indigo" />
                    <StatCard label="利益商品" value={data.stats.profitable} color="emerald" />
                    <StatCard label="未マッチ" value={data.stats.processed - data.stats.matched} color="amber" />
                </div>
            </div>

            {/* クイックフィルターボタン */}
            <div className="flex flex-wrap gap-2">
                <QuickButton label="全て表示" active={!minProfit && !minProfitRate && statusFilter === 'ALL'} onClick={() => applyPreset('all')} />
                <QuickButton label="利益 1,000円以上" active={minProfit === '1000'} onClick={() => applyPreset('profit1000')} />
                <QuickButton label="利益率 10%以上" active={minProfitRate === '10'} onClick={() => applyPreset('rate10')} />
                <QuickButton label="利益率 20%以上" active={minProfitRate === '20'} onClick={() => applyPreset('rate20')} />
                <QuickButton label="マッチ商品のみ" active={statusFilter === 'MATCHED'} onClick={() => applyPreset('rakuten_cheap')} />
            </div>

            {/* フィルターパネル */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200">
                <button
                    onClick={() => setShowFilterPanel(!showFilterPanel)}
                    className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                >
                    <span className="flex items-center gap-2">
                        <Filter className="w-4 h-4" /> 詳細フィルター
                    </span>
                    <span className="text-xs text-slate-400">{showFilterPanel ? '▲ 閉じる' : '▼ 開く'}</span>
                </button>

                {showFilterPanel && (
                    <div className="px-5 pb-5 border-t border-slate-100 pt-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">フリーワード</label>
                                <div className="relative">
                                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                                    <input type="text" value={keyword} onChange={e => { setKeyword(e.target.value); setCurrentPage(1); }}
                                        placeholder="商品名・ASIN・店舗名" className="w-full pl-8 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-400 outline-none" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">最低利益額（円）</label>
                                <input type="number" value={minProfit} onChange={e => { setMinProfit(e.target.value); setCurrentPage(1); }}
                                    placeholder="例: 500" className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-400 outline-none" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">最低利益率（%）</label>
                                <input type="number" value={minProfitRate} onChange={e => { setMinProfitRate(e.target.value); setCurrentPage(1); }}
                                    placeholder="例: 10" className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-400 outline-none" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">Amazon価格帯</label>
                                <div className="flex gap-1.5 items-center">
                                    <input type="number" value={minPrice} onChange={e => { setMinPrice(e.target.value); setCurrentPage(1); }}
                                        placeholder="下限" className="w-full px-2 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-400 outline-none" />
                                    <span className="text-slate-400 text-xs">〜</span>
                                    <input type="number" value={maxPrice} onChange={e => { setMaxPrice(e.target.value); setCurrentPage(1); }}
                                        placeholder="上限" className="w-full px-2 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-400 outline-none" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">ステータス</label>
                                <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setCurrentPage(1); }}
                                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-400 outline-none">
                                    <option value="ALL">すべて</option>
                                    <option value="MATCHED">マッチ済み</option>
                                    <option value="NO_MATCH">未マッチ</option>
                                    <option value="PENDING">処理中</option>
                                    <option value="ERROR">エラー</option>
                                </select>
                            </div>
                        </div>
                        <div className="mt-3 flex justify-end">
                            <button onClick={() => { setKeyword(''); setMinProfit(''); setMinProfitRate(''); setMinPrice(''); setMaxPrice(''); setStatusFilter('ALL'); setCurrentPage(1); }}
                                className="text-sm text-slate-500 hover:text-slate-700 px-3 py-1.5">
                                フィルターをリセット
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* 表示件数 + 結果サマリー */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                <p className="text-sm text-slate-500">
                    {sortedItems.length} 件中 {(currentPage - 1) * pageSize + 1}〜{Math.min(currentPage * pageSize, sortedItems.length)} を表示
                </p>
                <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-400 mr-1">表示件数:</span>
                    {[30, 50, 100, 500].map(n => (
                        <button key={n} onClick={() => { setPageSize(n); setCurrentPage(1); }}
                            className={`px-2.5 py-1 text-xs rounded-md transition-colors ${pageSize === n ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-slate-500 hover:bg-slate-100'}`}>
                            {n}
                        </button>
                    ))}
                </div>
            </div>

            {/* 結果テーブル */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                            <tr>
                                <th className="px-4 py-3 font-semibold">商品名</th>
                                <SortHeader label="Amazon価格" sortKey="amazonPrice" currentKey={sortKey} dir={sortDir} onClick={handleSort} />
                                <SortHeader label="楽天価格" sortKey="rakutenPrice" currentKey={sortKey} dir={sortDir} onClick={handleSort} />
                                <th className="px-4 py-3 font-semibold">楽天店舗</th>
                                <SortHeader label="利益" sortKey="profit" currentKey={sortKey} dir={sortDir} onClick={handleSort} />
                                <SortHeader label="利益率" sortKey="profitRate" currentKey={sortKey} dir={sortDir} onClick={handleSort} />
                                <SortHeader label="類似度" sortKey="similarity" currentKey={sortKey} dir={sortDir} onClick={handleSort} />
                                <th className="px-4 py-3 font-semibold">リンク</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {paginatedItems.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="p-8 text-center text-slate-400">
                                        {data.isRunning ? '楽天商品を検索中...' : '条件に一致する商品がありません'}
                                    </td>
                                </tr>
                            ) : (
                                paginatedItems.map(item => (
                                    <ComparisonRow key={item.asin} item={item} onPreview={() => setPreviewItem(item)} />
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ページネーション */}
            {totalPages > 1 && (
                <div className="flex justify-center items-center gap-2">
                    <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                        className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                        let page: number;
                        if (totalPages <= 7) {
                            page = i + 1;
                        } else if (currentPage <= 4) {
                            page = i + 1;
                        } else if (currentPage >= totalPages - 3) {
                            page = totalPages - 6 + i;
                        } else {
                            page = currentPage - 3 + i;
                        }
                        return (
                            <button key={page} onClick={() => setCurrentPage(page)}
                                className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${
                                    currentPage === page ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                                }`}>
                                {page}
                            </button>
                        );
                    })}
                    <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                        className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>
            )}

            {/* プレビューモーダル */}
            {previewItem && (
                <PreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
            )}
        </div>
    );
};

// --- サブコンポーネント ---

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
    const colorMap: Record<string, string> = {
        slate: 'bg-slate-50 text-slate-700 border-slate-100',
        indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
        emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
        amber: 'bg-amber-50 text-amber-700 border-amber-100',
    };
    return (
        <div className={`p-3 rounded-lg border text-center ${colorMap[color] || colorMap.slate}`}>
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-xs font-medium opacity-80">{label}</div>
        </div>
    );
}

function QuickButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button onClick={onClick}
            className={`px-4 py-2 text-sm rounded-lg font-medium transition-all ${
                active
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:border-slate-300'
            }`}>
            {label}
        </button>
    );
}

function SortHeader({ label, sortKey, currentKey, dir, onClick }: {
    label: string; sortKey: string; currentKey: string; dir: 'asc' | 'desc'; onClick: (key: string) => void;
}) {
    const isActive = sortKey === currentKey;
    return (
        <th className="px-4 py-3 font-semibold cursor-pointer select-none hover:bg-slate-100 transition-colors"
            onClick={() => onClick(sortKey)}>
            <span className="flex items-center gap-1">
                {label}
                {isActive && <span className="text-indigo-500">{dir === 'desc' ? '↓' : '↑'}</span>}
            </span>
        </th>
    );
}

function ComparisonRow({ item, onPreview }: { item: ComparisonItem; onPreview: () => void }) {
    const isProfitable = item.estimatedProfit !== null && item.estimatedProfit > 0;
    const isHighProfit = item.profitRate !== null && item.profitRate >= 20;

    return (
        <tr className={`hover:bg-slate-50 transition-colors ${isHighProfit ? 'bg-emerald-50/30' : ''}`}>
            {/* 商品名 */}
            <td className="px-4 py-3 max-w-[280px]">
                <div className="flex items-start gap-2">
                    {item.rakutenImageUrl && item.status === 'MATCHED' && (
                        <img src={item.rakutenImageUrl} alt="" className="w-12 h-12 object-contain rounded border border-slate-200 flex-shrink-0 bg-white" />
                    )}
                    <div className="min-w-0">
                        <div className="font-mono text-xs text-slate-400">{item.asin}</div>
                        <div className="text-slate-700 line-clamp-2 text-sm" title={item.amazonTitle}>{item.amazonTitle}</div>
                        {item.rakutenTitle && item.status === 'MATCHED' && (
                            <div className="text-xs text-rose-500 line-clamp-1 mt-0.5" title={item.rakutenTitle}>
                                楽天: {item.rakutenTitle}
                            </div>
                        )}
                        {item.status === 'PENDING' && (
                            <span className="inline-flex items-center text-xs text-slate-400 mt-1">
                                <span className="animate-spin h-3 w-3 border-2 border-indigo-400 rounded-full border-t-transparent mr-1" />
                                検索中...
                            </span>
                        )}
                        {item.status === 'NO_MATCH' && (
                            <span className="text-xs text-amber-500 mt-1">マッチなし</span>
                        )}
                        {item.status === 'ERROR' && (
                            <span className="text-xs text-red-500 mt-1">{item.errorMessage || 'エラー'}</span>
                        )}
                    </div>
                </div>
            </td>

            {/* Amazon価格 */}
            <td className="px-4 py-3 whitespace-nowrap">
                <div className="font-medium text-slate-800">{formatCurrency(item.amazonPrice, 'JPY')}</div>
                <div className="text-xs text-slate-400">手数料 {formatCurrency(item.estimatedFee, 'JPY')}</div>
            </td>

            {/* 楽天価格 */}
            <td className="px-4 py-3 whitespace-nowrap">
                {item.rakutenPrice !== null ? (
                    <div className="font-medium text-rose-600">{formatCurrency(item.rakutenPrice, 'JPY')}</div>
                ) : (
                    <span className="text-slate-300">-</span>
                )}
            </td>

            {/* 楽天店舗 */}
            <td className="px-4 py-3 max-w-[140px]">
                {item.rakutenShop ? (
                    <span className="text-xs text-slate-600 line-clamp-1" title={item.rakutenShop}>{item.rakutenShop}</span>
                ) : (
                    <span className="text-slate-300">-</span>
                )}
            </td>

            {/* 利益 */}
            <td className="px-4 py-3 whitespace-nowrap">
                {item.estimatedProfit !== null ? (
                    <div className={`font-bold flex items-center gap-1 ${isProfitable ? 'text-emerald-600' : 'text-red-500'}`}>
                        {isProfitable ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                        {formatCurrency(item.estimatedProfit, 'JPY')}
                    </div>
                ) : (
                    <span className="text-slate-300">-</span>
                )}
            </td>

            {/* 利益率 */}
            <td className="px-4 py-3 whitespace-nowrap">
                {item.profitRate !== null ? (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                        item.profitRate >= 20 ? 'bg-emerald-100 text-emerald-700' :
                        item.profitRate >= 10 ? 'bg-blue-100 text-blue-700' :
                        item.profitRate >= 0 ? 'bg-slate-100 text-slate-600' :
                        'bg-red-100 text-red-700'
                    }`}>
                        {item.profitRate > 0 ? '+' : ''}{item.profitRate}%
                    </span>
                ) : (
                    <span className="text-slate-300">-</span>
                )}
            </td>

            {/* 類似度 */}
            <td className="px-4 py-3 whitespace-nowrap">
                {item.similarityScore > 0 ? (
                    <div className="flex items-center gap-1.5">
                        <div className="w-12 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${
                                item.similarityScore >= 0.8 ? 'bg-emerald-500' :
                                item.similarityScore >= 0.7 ? 'bg-blue-500' : 'bg-amber-500'
                            }`} style={{ width: `${Math.round(item.similarityScore * 100)}%` }} />
                        </div>
                        <span className="text-xs text-slate-500">{Math.round(item.similarityScore * 100)}%</span>
                    </div>
                ) : (
                    <span className="text-slate-300">-</span>
                )}
            </td>

            {/* リンク */}
            <td className="px-4 py-3">
                <div className="flex flex-col gap-1.5">
                    {item.status === 'MATCHED' && (
                        <button onClick={onPreview} className="flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600 transition-colors">
                            <Eye className="w-3.5 h-3.5" /> 詳細
                        </button>
                    )}
                    <a href={item.amazonUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 transition-colors">
                        <ExternalLink className="w-3.5 h-3.5" /> Amazon
                    </a>
                    {item.rakutenUrl && (
                        <a href={item.rakutenUrl} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs text-rose-500 hover:text-rose-700 transition-colors">
                            <ExternalLink className="w-3.5 h-3.5" /> 楽天
                        </a>
                    )}
                </div>
            </td>
        </tr>
    );
}

function PreviewModal({ item, onClose }: { item: ComparisonItem; onClose: () => void }) {
    const isProfitable = item.estimatedProfit !== null && item.estimatedProfit > 0;

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                {/* ヘッダー */}
                <div className="flex items-center justify-between p-5 border-b border-slate-200">
                    <h3 className="text-lg font-bold text-slate-800">商品プレビュー</h3>
                    <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg transition-colors">
                        <X className="w-5 h-5 text-slate-500" />
                    </button>
                </div>

                <div className="p-5 space-y-5">
                    {/* 画像 + 基本情報 */}
                    <div className="flex gap-5">
                        {item.rakutenImageUrl && (
                            <img src={item.rakutenImageUrl} alt="" className="w-32 h-32 object-contain rounded-lg border border-slate-200 bg-white flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                            <div className="font-mono text-xs text-slate-400 mb-1">{item.asin}</div>
                            <div className="text-sm font-medium text-slate-800 mb-2">{item.amazonTitle}</div>
                            {item.rakutenTitle && (
                                <div className="text-xs text-rose-500">楽天: {item.rakutenTitle}</div>
                            )}
                            {item.rakutenShop && (
                                <div className="text-xs text-slate-500 mt-1">店舗: {item.rakutenShop}</div>
                            )}
                        </div>
                    </div>

                    {/* 価格比較 */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-indigo-50 rounded-xl p-4 text-center border border-indigo-100">
                            <div className="text-xs font-medium text-indigo-500 mb-1">Amazon価格</div>
                            <div className="text-2xl font-bold text-indigo-700">{formatCurrency(item.amazonPrice, 'JPY')}</div>
                            <div className="text-xs text-indigo-400 mt-1">手数料 {formatCurrency(item.estimatedFee, 'JPY')}</div>
                        </div>
                        <div className="bg-rose-50 rounded-xl p-4 text-center border border-rose-100">
                            <div className="text-xs font-medium text-rose-500 mb-1">楽天価格</div>
                            <div className="text-2xl font-bold text-rose-700">{item.rakutenPrice !== null ? formatCurrency(item.rakutenPrice, 'JPY') : '-'}</div>
                            <div className="text-xs text-rose-400 mt-1">類似度 {Math.round(item.similarityScore * 100)}%</div>
                        </div>
                    </div>

                    {/* 利益情報 */}
                    {item.estimatedProfit !== null && (
                        <div className={`rounded-xl p-4 text-center border ${isProfitable ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                            <div className={`text-xs font-medium mb-1 ${isProfitable ? 'text-emerald-500' : 'text-red-500'}`}>推定利益</div>
                            <div className={`text-3xl font-bold ${isProfitable ? 'text-emerald-700' : 'text-red-700'}`}>
                                {formatCurrency(item.estimatedProfit, 'JPY')}
                            </div>
                            <div className={`text-sm font-medium mt-1 ${isProfitable ? 'text-emerald-600' : 'text-red-600'}`}>
                                利益率 {item.profitRate !== null ? `${item.profitRate > 0 ? '+' : ''}${item.profitRate}%` : '-'}
                            </div>
                        </div>
                    )}

                    {/* リンクボタン */}
                    <div className="flex gap-3">
                        <a href={item.amazonUrl} target="_blank" rel="noopener noreferrer"
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium">
                            <ExternalLink className="w-4 h-4" /> Amazonで見る
                        </a>
                        {item.rakutenUrl && (
                            <a href={item.rakutenUrl} target="_blank" rel="noopener noreferrer"
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-colors text-sm font-medium">
                                <ExternalLink className="w-4 h-4" /> 楽天で見る
                            </a>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ComparePage;
