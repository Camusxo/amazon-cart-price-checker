import React, { useEffect, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import Papa from 'papaparse';
import {
    Download,
    RefreshCw,
    ExternalLink,
    Filter,
    ChevronLeft,
    ChevronRight,
    X,
    Star,
    Square,
    Play,
    CheckCircle,
} from 'lucide-react';
import { ComparisonSession, ComparisonItem } from '../types';
import { formatCurrency } from '../lib/utils';

interface SavedFilter {
    keyword: string; excludeKeyword: string; minProfit: string; minProfitMax: string;
    minProfitRate: string; minProfitRateMax: string; minPrice: string; maxPrice: string;
    minRakutenPrice: string; maxRakutenPrice: string; minMonthlySold: string; maxMonthlySold: string;
    minPoints: string; maxPoints: string; favoriteFilter: 'all' | 'yes' | 'no';
    confirmedFilter: 'all' | 'yes' | 'no'; statusFilter: string;
    minProfitWithPoints: string; maxProfitWithPoints: string;
    minProfitRateWithPoints: string; maxProfitRateWithPoints: string;
}

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
    const [showFavoriteOnly, setShowFavoriteOnly] = useState(false);

    // 詳細フィルター
    const [excludeKeyword, setExcludeKeyword] = useState('');
    const [favoriteFilter, setFavoriteFilter] = useState<'all' | 'yes' | 'no'>('all');
    const [confirmedFilter, setConfirmedFilter] = useState<'all' | 'yes' | 'no'>('all');
    const [minProfitMax, setMinProfitMax] = useState('');
    const [minMonthlySold, setMinMonthlySold] = useState('');
    const [maxMonthlySold, setMaxMonthlySold] = useState('');
    const [minRakutenPrice, setMinRakutenPrice] = useState('');
    const [maxRakutenPrice, setMaxRakutenPrice] = useState('');
    const [minPoints, setMinPoints] = useState('');
    const [maxPoints, setMaxPoints] = useState('');
    const [minProfitRateMax, setMinProfitRateMax] = useState('');
    const [minProfitWithPoints, setMinProfitWithPoints] = useState('');
    const [maxProfitWithPoints, setMaxProfitWithPoints] = useState('');
    const [minProfitRateWithPoints, setMinProfitRateWithPoints] = useState('');
    const [maxProfitRateWithPoints, setMaxProfitRateWithPoints] = useState('');

    // 確認済みフラグ用（ComparisonItemにないのでローカル管理）
    const [confirmedAsins, setConfirmedAsins] = useState<Set<string>>(new Set());

    // カスタムフィルター保存
    const [savedFilters, setSavedFilters] = useState<Record<string, SavedFilter>>(() => {
        try { return JSON.parse(localStorage.getItem('pricecheck_filters') || '{}'); } catch { return {}; }
    });

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

    const handleStop = async () => {
        if (!compareId) return;
        try {
            await axios.post(`/api/compare/${compareId}/stop`);
            fetchData();
        } catch { alert('停止に失敗しました'); }
    };

    const handleResume = async () => {
        if (!compareId) return;
        try {
            await axios.post(`/api/compare/${compareId}/resume`);
            fetchData();
        } catch { alert('再開に失敗しました'); }
    };

    const toggleFavorite = async (asin: string) => {
        if (!compareId) return;
        try {
            await axios.patch(`/api/compare/${compareId}/items/${asin}/favorite`);
            fetchData();
        } catch { /* silent */ }
    };

    const toggleConfirmed = (asin: string) => {
        setConfirmedAsins(prev => {
            const next = new Set(prev);
            if (next.has(asin)) next.delete(asin);
            else next.add(asin);
            return next;
        });
    };

    const saveFilter = (slot: string) => {
        const filter: SavedFilter = {
            keyword, excludeKeyword, minProfit, minProfitMax,
            minProfitRate, minProfitRateMax,
            minPrice, maxPrice, minRakutenPrice, maxRakutenPrice,
            minMonthlySold, maxMonthlySold, minPoints, maxPoints,
            favoriteFilter, confirmedFilter, statusFilter,
            minProfitWithPoints, maxProfitWithPoints,
            minProfitRateWithPoints, maxProfitRateWithPoints,
        };
        const updated = { ...savedFilters, [slot]: filter };
        setSavedFilters(updated);
        localStorage.setItem('pricecheck_filters', JSON.stringify(updated));
    };

    const loadFilter = (slot: string) => {
        const f = savedFilters[slot];
        if (!f) return;
        setKeyword(f.keyword || '');
        setExcludeKeyword(f.excludeKeyword || '');
        setMinProfit(f.minProfit || '');
        setMinProfitMax(f.minProfitMax || '');
        setMinProfitRate(f.minProfitRate || '');
        setMinProfitRateMax(f.minProfitRateMax || '');
        setMinPrice(f.minPrice || '');
        setMaxPrice(f.maxPrice || '');
        setMinRakutenPrice(f.minRakutenPrice || '');
        setMaxRakutenPrice(f.maxRakutenPrice || '');
        setMinMonthlySold(f.minMonthlySold || '');
        setMaxMonthlySold(f.maxMonthlySold || '');
        setMinPoints(f.minPoints || '');
        setMaxPoints(f.maxPoints || '');
        setFavoriteFilter(f.favoriteFilter || 'all');
        setConfirmedFilter(f.confirmedFilter || 'all');
        setStatusFilter(f.statusFilter || 'ALL');
        setMinProfitWithPoints(f.minProfitWithPoints || '');
        setMaxProfitWithPoints(f.maxProfitWithPoints || '');
        setMinProfitRateWithPoints(f.minProfitRateWithPoints || '');
        setMaxProfitRateWithPoints(f.maxProfitRateWithPoints || '');
        setCurrentPage(1);
    };

    const clearAllFilters = () => {
        setKeyword(''); setExcludeKeyword(''); setMinProfit(''); setMinProfitMax('');
        setMinProfitRate(''); setMinProfitRateMax(''); setMinPrice(''); setMaxPrice('');
        setMinRakutenPrice(''); setMaxRakutenPrice(''); setMinMonthlySold(''); setMaxMonthlySold('');
        setMinPoints(''); setMaxPoints(''); setFavoriteFilter('all'); setConfirmedFilter('all');
        setStatusFilter('ALL'); setShowFavoriteOnly(false);
        setMinProfitWithPoints(''); setMaxProfitWithPoints('');
        setMinProfitRateWithPoints(''); setMaxProfitRateWithPoints('');
        setCurrentPage(1);
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
            case 'matched':
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
            // お気に入りフィルター
            if (showFavoriteOnly && !item.favorite) return false;
            if (favoriteFilter === 'yes' && !item.favorite) return false;
            if (favoriteFilter === 'no' && item.favorite) return false;

            // 確認済みフラグ
            if (confirmedFilter === 'yes' && !confirmedAsins.has(item.asin)) return false;
            if (confirmedFilter === 'no' && confirmedAsins.has(item.asin)) return false;

            // キーワード検索
            if (keyword) {
                const kw = keyword.toLowerCase();
                const matchTitle = item.amazonTitle.toLowerCase().includes(kw) ||
                    (item.rakutenTitle && item.rakutenTitle.toLowerCase().includes(kw));
                const matchAsin = item.asin.toLowerCase().includes(kw);
                const matchShop = item.rakutenShop && item.rakutenShop.toLowerCase().includes(kw);
                const matchJan = item.janCode && item.janCode.includes(kw);
                if (!matchTitle && !matchAsin && !matchShop && !matchJan) return false;
            }

            // 除外ワード
            if (excludeKeyword) {
                const ew = excludeKeyword.toLowerCase();
                if (item.amazonTitle.toLowerCase().includes(ew)) return false;
                if (item.rakutenTitle && item.rakutenTitle.toLowerCase().includes(ew)) return false;
            }

            // ステータス
            if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;

            // 利益（現金）範囲
            if (minProfit && (item.estimatedProfit === null || item.estimatedProfit < Number(minProfit))) return false;
            if (minProfitMax && (item.estimatedProfit === null || item.estimatedProfit > Number(minProfitMax))) return false;

            // 利益率 範囲
            if (minProfitRate && (item.profitRate === null || item.profitRate < Number(minProfitRate))) return false;
            if (minProfitRateMax && (item.profitRate === null || item.profitRate > Number(minProfitRateMax))) return false;

            // Amazon販売価格 範囲
            if (minPrice && item.amazonPrice < Number(minPrice)) return false;
            if (maxPrice && item.amazonPrice > Number(maxPrice)) return false;

            // 楽天購入価格 範囲
            if (minRakutenPrice && (item.rakutenPrice === null || item.rakutenPrice < Number(minRakutenPrice))) return false;
            if (maxRakutenPrice && (item.rakutenPrice === null || item.rakutenPrice > Number(maxRakutenPrice))) return false;

            // 月間販売個数 範囲
            if (minMonthlySold && (item.monthlySold === null || item.monthlySold < Number(minMonthlySold))) return false;
            if (maxMonthlySold && (item.monthlySold === null || item.monthlySold > Number(maxMonthlySold))) return false;

            // ポイント合計 範囲
            const points = item.rakutenPrice ? Math.round(item.rakutenPrice * (item.rakutenPointRate / 100)) : 0;
            if (minPoints && points < Number(minPoints)) return false;
            if (maxPoints && points > Number(maxPoints)) return false;

            // 利益（ポイント込み）範囲
            const profitWP = item.estimatedProfit !== null ? item.estimatedProfit + points : null;
            if (minProfitWithPoints && (profitWP === null || profitWP < Number(minProfitWithPoints))) return false;
            if (maxProfitWithPoints && (profitWP === null || profitWP > Number(maxProfitWithPoints))) return false;

            // 利益率（ポイント込み）範囲
            const profitRateWP = profitWP !== null && item.amazonPrice > 0 ? Math.round((profitWP / item.amazonPrice) * 1000) / 10 : null;
            if (minProfitRateWithPoints && (profitRateWP === null || profitRateWP < Number(minProfitRateWithPoints))) return false;
            if (maxProfitRateWithPoints && (profitRateWP === null || profitRateWP > Number(maxProfitRateWithPoints))) return false;

            return true;
        });
    }, [data, keyword, excludeKeyword, statusFilter, minProfit, minProfitMax, minProfitRate, minProfitRateMax,
        minPrice, maxPrice, minRakutenPrice, maxRakutenPrice, minMonthlySold, maxMonthlySold,
        minPoints, maxPoints, favoriteFilter, confirmedFilter, confirmedAsins, showFavoriteOnly,
        minProfitWithPoints, maxProfitWithPoints, minProfitRateWithPoints, maxProfitRateWithPoints]);

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
            'JANコード': i.janCode || '',
            '月間販売個数': i.monthlySold !== null ? i.monthlySold : '',
            'Amazon商品名': i.amazonTitle,
            'Amazon販売価格': i.amazonPrice,
            '楽天商品名': i.rakutenTitle || '',
            '楽天仕入れ価格': i.rakutenPrice || '',
            '楽天店舗': i.rakutenShop || '',
            'Amazon手数料': i.estimatedFee,
            '獲得ポイント': i.rakutenPrice ? Math.round(i.rakutenPrice * (i.rakutenPointRate / 100)) : '',
            '利益（現金）': i.estimatedProfit || '',
            '利益率': i.profitRate !== null ? `${i.profitRate}%` : '',
            '類似度': Math.round(i.similarityScore * 100) + '%',
            'ステータス': i.status,
            'メモ': i.memo || '',
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
        <div className="space-y-4">
            {/* ヘッダー + 進捗 */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-3 mb-3">
                    <div>
                        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                            <span className="text-indigo-600">Amazon</span>
                            <span className="text-slate-400">vs</span>
                            <span className="text-rose-500">楽天</span>
                            <span className="text-slate-700 ml-1">価格比較</span>
                        </h2>
                        <p className="text-xs text-slate-500 mt-1">
                            {data.isRunning ? '楽天商品を検索中...' : '比較完了'}
                            {' '}| ID: {data.id.slice(0, 8)}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {data.isRunning && (
                            <>
                                <button onClick={handleStop} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors">
                                    <Square className="w-3.5 h-3.5" /> 処理を完了
                                </button>
                            </>
                        )}
                        {!data.isRunning && data.items.some(i => i.status === 'PENDING') && (
                            <button onClick={handleResume} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-green-500 hover:bg-green-600 rounded-lg transition-colors">
                                <Play className="w-3.5 h-3.5" /> 再開
                            </button>
                        )}
                        {!data.isRunning && (
                            <button onClick={handleRefresh} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors border border-indigo-200">
                                <RefreshCw className="w-3.5 h-3.5" /> 再取得
                            </button>
                        )}
                        <button onClick={handleExportCSV} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 rounded-lg transition-colors border border-slate-300">
                            <Download className="w-3.5 h-3.5" /> CSV出力
                        </button>
                    </div>
                </div>

                {/* プログレスバー */}
                <div className="relative h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="absolute top-0 left-0 h-full bg-gradient-to-r from-indigo-500 to-rose-500 transition-all duration-500" style={{ width: `${progress}%` }} />
                </div>
                <div className="flex justify-between text-xs text-slate-500 mt-1">
                    <span>{data.stats.processed} / {data.stats.total} 処理済み</span>
                    <span>{progress}%</span>
                </div>

                {/* 統計カード */}
                <div className="grid grid-cols-4 gap-2 mt-4">
                    <StatCard label="合計" value={data.stats.total} color="slate" />
                    <StatCard label="マッチ" value={data.stats.matched} color="indigo" />
                    <StatCard label="利益商品" value={data.stats.profitable} color="emerald" />
                    <StatCard label="未マッチ" value={data.stats.processed - data.stats.matched} color="amber" />
                </div>
            </div>

            {/* フィルターバー */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 px-4 py-2.5 flex flex-wrap items-center gap-2">
                <QuickButton label="全て表示" active={!minProfit && !minProfitRate && statusFilter === 'ALL'} onClick={() => applyPreset('all')} />
                <QuickButton label="利益¥1,000以上" active={minProfit === '1000'} onClick={() => applyPreset('profit1000')} />
                <QuickButton label="利益率10%以上" active={minProfitRate === '10'} onClick={() => applyPreset('rate10')} />
                <QuickButton label="利益率20%以上" active={minProfitRate === '20'} onClick={() => applyPreset('rate20')} />
                <QuickButton label="マッチ商品のみ" active={statusFilter === 'MATCHED'} onClick={() => applyPreset('matched')} />
                <QuickButton label="⭐ お気に入り" active={showFavoriteOnly} onClick={() => setShowFavoriteOnly(!showFavoriteOnly)} />
                <div className="ml-auto flex items-center gap-2">
                    <span className="text-xs text-slate-400">表示件数</span>
                    <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                        className="px-2 py-1 text-xs border border-slate-300 rounded bg-white">
                        {[30, 50, 100, 500].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <span className="text-xs text-slate-500">検索結果: {sortedItems.length}件</span>
                </div>
            </div>

            {/* 詳細フィルター */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200">
                <button onClick={() => setShowFilterPanel(!showFilterPanel)}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                    <span className="flex items-center gap-1.5"><Filter className="w-3.5 h-3.5" /> フィルタ設定</span>
                    <span className="text-xs text-slate-400">{showFilterPanel ? '▲' : '▼'}</span>
                </button>
                {showFilterPanel && (
                    <div className="px-4 pb-4 border-t border-slate-100 pt-3">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {/* 左カラム */}
                            <div className="space-y-2">
                                <FilterRow label="検索:">
                                    <input type="text" value={keyword} onChange={e => { setKeyword(e.target.value); setCurrentPage(1); }}
                                        placeholder="フリーワード" className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-indigo-400 outline-none" />
                                </FilterRow>
                                <FilterRow label="お気に入り:">
                                    <div className="flex gap-3 text-xs">
                                        {(['all', 'yes', 'no'] as const).map(v => (
                                            <label key={v} className="flex items-center gap-1 cursor-pointer">
                                                <input type="radio" name="fav" checked={favoriteFilter === v} onChange={() => { setFavoriteFilter(v); setCurrentPage(1); }} className="w-3 h-3" />
                                                {v === 'all' ? 'すべて' : v === 'yes' ? '登録済' : '未登録'}
                                            </label>
                                        ))}
                                    </div>
                                </FilterRow>
                                <FilterRow label="確認済み:">
                                    <div className="flex gap-3 text-xs">
                                        {(['all', 'yes', 'no'] as const).map(v => (
                                            <label key={v} className="flex items-center gap-1 cursor-pointer">
                                                <input type="radio" name="conf" checked={confirmedFilter === v} onChange={() => { setConfirmedFilter(v); setCurrentPage(1); }} className="w-3 h-3" />
                                                {v === 'all' ? 'すべて' : v === 'yes' ? '確認済' : '未確認'}
                                            </label>
                                        ))}
                                    </div>
                                </FilterRow>
                                <FilterRow label="除外ワード:">
                                    <input type="text" value={excludeKeyword} onChange={e => { setExcludeKeyword(e.target.value); setCurrentPage(1); }}
                                        className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-indigo-400 outline-none" />
                                </FilterRow>
                                <FilterRow label="利益:">
                                    <div className="flex gap-1 items-center">
                                        <input type="number" value={minProfit} onChange={e => { setMinProfit(e.target.value); setCurrentPage(1); }}
                                            placeholder="下限" className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-indigo-400 outline-none" />
                                        <span className="text-slate-400 text-[10px]">~</span>
                                        <input type="number" value={minProfitMax} onChange={e => { setMinProfitMax(e.target.value); setCurrentPage(1); }}
                                            placeholder="上限" className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-indigo-400 outline-none" />
                                    </div>
                                </FilterRow>
                                <FilterRow label="1ヶ月販売個数:">
                                    <div className="flex gap-1 items-center">
                                        <input type="number" value={minMonthlySold} onChange={e => { setMinMonthlySold(e.target.value); setCurrentPage(1); }}
                                            placeholder="下限" className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-indigo-400 outline-none" />
                                        <span className="text-slate-400 text-[10px]">~</span>
                                        <input type="number" value={maxMonthlySold} onChange={e => { setMaxMonthlySold(e.target.value); setCurrentPage(1); }}
                                            placeholder="上限" className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-indigo-400 outline-none" />
                                    </div>
                                </FilterRow>
                                <FilterRow label="販売価格:">
                                    <div className="flex gap-1 items-center">
                                        <input type="number" value={minPrice} onChange={e => { setMinPrice(e.target.value); setCurrentPage(1); }}
                                            placeholder="下限" className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-indigo-400 outline-none" />
                                        <span className="text-slate-400 text-[10px]">~</span>
                                        <input type="number" value={maxPrice} onChange={e => { setMaxPrice(e.target.value); setCurrentPage(1); }}
                                            placeholder="上限" className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-indigo-400 outline-none" />
                                    </div>
                                </FilterRow>
                            </div>

                            {/* 中央カラム */}
                            <div className="space-y-2">
                                <FilterRow label="購入価格:">
                                    <div className="flex gap-1 items-center">
                                        <input type="number" value={minRakutenPrice} onChange={e => { setMinRakutenPrice(e.target.value); setCurrentPage(1); }}
                                            placeholder="下限" className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-indigo-400 outline-none" />
                                        <span className="text-slate-400 text-[10px]">~</span>
                                        <input type="number" value={maxRakutenPrice} onChange={e => { setMaxRakutenPrice(e.target.value); setCurrentPage(1); }}
                                            placeholder="上限" className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-indigo-400 outline-none" />
                                    </div>
                                </FilterRow>
                                <FilterRow label="ポイント合計:">
                                    <div className="flex gap-1 items-center">
                                        <input type="number" value={minPoints} onChange={e => { setMinPoints(e.target.value); setCurrentPage(1); }}
                                            placeholder="下限" className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-indigo-400 outline-none" />
                                        <span className="text-slate-400 text-[10px]">~</span>
                                        <input type="number" value={maxPoints} onChange={e => { setMaxPoints(e.target.value); setCurrentPage(1); }}
                                            placeholder="上限" className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-indigo-400 outline-none" />
                                    </div>
                                </FilterRow>
                                <FilterRow label="利益率:">
                                    <div className="flex gap-1 items-center">
                                        <input type="number" value={minProfitRate} onChange={e => { setMinProfitRate(e.target.value); setCurrentPage(1); }}
                                            placeholder="下限%" className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-indigo-400 outline-none" />
                                        <span className="text-slate-400 text-[10px]">~</span>
                                        <input type="number" value={minProfitRateMax} onChange={e => { setMinProfitRateMax(e.target.value); setCurrentPage(1); }}
                                            placeholder="上限%" className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-indigo-400 outline-none" />
                                    </div>
                                </FilterRow>
                                <FilterRow label="利益(ポイント込み):">
                                    <div className="flex gap-1 items-center">
                                        <input type="number" value={minProfitWithPoints} onChange={e => { setMinProfitWithPoints(e.target.value); setCurrentPage(1); }}
                                            placeholder="下限" className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-indigo-400 outline-none" />
                                        <span className="text-slate-400 text-[10px]">~</span>
                                        <input type="number" value={maxProfitWithPoints} onChange={e => { setMaxProfitWithPoints(e.target.value); setCurrentPage(1); }}
                                            placeholder="上限" className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-indigo-400 outline-none" />
                                    </div>
                                </FilterRow>
                                <FilterRow label="利益率(ポイント込み):">
                                    <div className="flex gap-1 items-center">
                                        <input type="number" value={minProfitRateWithPoints} onChange={e => { setMinProfitRateWithPoints(e.target.value); setCurrentPage(1); }}
                                            placeholder="下限%" className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-indigo-400 outline-none" />
                                        <span className="text-slate-400 text-[10px]">~</span>
                                        <input type="number" value={maxProfitRateWithPoints} onChange={e => { setMaxProfitRateWithPoints(e.target.value); setCurrentPage(1); }}
                                            placeholder="上限%" className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-indigo-400 outline-none" />
                                    </div>
                                </FilterRow>
                            </div>

                            {/* 右カラム */}
                            <div className="space-y-2">
                                <FilterRow label="フィルターを保存:">
                                    <div className="flex gap-1.5">
                                        {['カスタム1', 'カスタム2', 'カスタム3'].map((name, i) => (
                                            <div key={i} className="flex flex-col items-center gap-0.5">
                                                <button onClick={() => saveFilter(`custom${i + 1}`)}
                                                    className={`px-2.5 py-1 text-[10px] rounded border transition-colors ${
                                                        savedFilters[`custom${i + 1}`] ? 'bg-cyan-50 border-cyan-400 text-cyan-700' : 'bg-white border-slate-300 text-slate-500 hover:border-cyan-400'
                                                    }`}>
                                                    {name}
                                                </button>
                                                {savedFilters[`custom${i + 1}`] && (
                                                    <button onClick={() => loadFilter(`custom${i + 1}`)} className="text-[9px] text-cyan-600 hover:underline">読込</button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </FilterRow>
                                <div className="pt-4 flex gap-2">
                                    <button onClick={clearAllFilters}
                                        className="flex-1 px-3 py-2 text-xs text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors font-medium">
                                        フィルタ設定をクリア
                                    </button>
                                    <button onClick={() => setShowFilterPanel(false)}
                                        className="flex-1 px-3 py-2 text-xs text-white bg-cyan-500 hover:bg-cyan-600 rounded-lg transition-colors font-medium">
                                        フィルタを適用
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* ===== メインテーブル (PoiPoi風) ===== */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                        <thead className="bg-sky-50 border-b border-sky-200">
                            <tr>
                                <th className="px-2 py-2.5 font-bold text-sky-800 whitespace-nowrap border-r border-sky-200 w-8">★</th>
                                <th className="px-3 py-2.5 font-bold text-sky-800 whitespace-nowrap border-r border-sky-200">商品画像</th>
                                <th className="px-3 py-2.5 font-bold text-sky-800 whitespace-nowrap border-r border-sky-200">ASIN</th>
                                <th className="px-3 py-2.5 font-bold text-sky-800 whitespace-nowrap w-[300px] border-r border-sky-200">Keepa</th>
                                <th className="px-3 py-2.5 font-bold text-sky-800 whitespace-nowrap min-w-[250px] border-r border-sky-200">商品名</th>
                                <SortHeader label="楽天仕入れ価格" sortKey="rakutenPrice" currentKey={sortKey} dir={sortDir} onClick={handleSort} />
                                <SortHeader label="Amazon販売価格" sortKey="amazonPrice" currentKey={sortKey} dir={sortDir} onClick={handleSort} />
                                <th className="px-3 py-2.5 font-bold text-sky-800 whitespace-nowrap border-r border-sky-200">Amazon手数料</th>
                                <th className="px-3 py-2.5 font-bold text-sky-800 whitespace-nowrap border-r border-sky-200">獲得ポイント</th>
                                <SortHeader label="利益" sortKey="profitRate" currentKey={sortKey} dir={sortDir} onClick={handleSort} isLast />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                            {paginatedItems.length === 0 ? (
                                <tr>
                                    <td colSpan={10} className="p-8 text-center text-slate-400">
                                        {data.isRunning ? '楽天商品を検索中...' : '条件に一致する商品がありません'}
                                    </td>
                                </tr>
                            ) : (
                                paginatedItems.map(item => (
                                    <ProductRow key={item.asin} item={item} onPreview={() => setPreviewItem(item)} compareId={compareId || ''}
                                        onToggleFavorite={() => toggleFavorite(item.asin)}
                                        isConfirmed={confirmedAsins.has(item.asin)}
                                        onToggleConfirmed={() => toggleConfirmed(item.asin)} />
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ページネーション */}
            {totalPages > 1 && (
                <div className="flex justify-center items-center gap-1.5">
                    <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                        className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                        let page: number;
                        if (totalPages <= 7) page = i + 1;
                        else if (currentPage <= 4) page = i + 1;
                        else if (currentPage >= totalPages - 3) page = totalPages - 6 + i;
                        else page = currentPage - 3 + i;
                        return (
                            <button key={page} onClick={() => setCurrentPage(page)}
                                className={`w-8 h-8 rounded text-xs font-medium transition-colors ${
                                    currentPage === page ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                                }`}>
                                {page}
                            </button>
                        );
                    })}
                    <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                        className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>
            )}

            {/* プレビューモーダル */}
            {previewItem && <PreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />}
        </div>
    );
};

// ===== サブコンポーネント =====

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
    const colorMap: Record<string, string> = {
        slate: 'bg-slate-50 text-slate-700 border-slate-200',
        indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        amber: 'bg-amber-50 text-amber-700 border-amber-200',
    };
    return (
        <div className={`px-3 py-2 rounded-lg border text-center ${colorMap[color] || colorMap.slate}`}>
            <div className="text-xl font-bold">{value}</div>
            <div className="text-[10px] font-medium opacity-80">{label}</div>
        </div>
    );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-slate-600 w-28 flex-shrink-0 text-right">{label}</span>
            <div className="flex-1">{children}</div>
        </div>
    );
}

function QuickButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button onClick={onClick}
            className={`px-3 py-1.5 text-xs rounded font-medium transition-all border ${
                active
                    ? 'bg-sky-500 text-white border-sky-500 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}>
            {label}
        </button>
    );
}

function SortHeader({ label, sortKey, currentKey, dir, onClick, isLast = false }: {
    label: string; sortKey: string; currentKey: string; dir: 'asc' | 'desc'; onClick: (key: string) => void; isLast?: boolean;
}) {
    const isActive = sortKey === currentKey;
    return (
        <th className={`px-3 py-2.5 font-bold text-sky-800 whitespace-nowrap cursor-pointer select-none hover:bg-sky-100 transition-colors ${!isLast ? 'border-r border-sky-200' : ''}`}
            onClick={() => onClick(sortKey)}>
            <span className="flex items-center gap-0.5">
                {label}
                {isActive && <span className="text-indigo-500 text-[10px]">{dir === 'desc' ? '▼' : '▲'}</span>}
            </span>
        </th>
    );
}

// ===== PoiPoi風 商品行 =====
function ProductRow({ item, onPreview, compareId, onToggleFavorite, isConfirmed, onToggleConfirmed }: { item: ComparisonItem; onPreview: () => void; compareId: string; onToggleFavorite: () => void; isConfirmed: boolean; onToggleConfirmed: () => void }) {
    const isMatched = item.status === 'MATCHED';
    const isProfitable = item.estimatedProfit !== null && item.estimatedProfit > 0;
    const rakutenPoints = item.rakutenPrice ? Math.round(item.rakutenPrice * (item.rakutenPointRate / 100)) : 0;
    const profitWithPoints = item.estimatedProfit !== null ? item.estimatedProfit + rakutenPoints : null;

    // Keepa chart URL（無料の概要グラフ）
    const keepaChartUrl = `https://graph.keepa.com/pricehistory.png?asin=${item.asin}&domain=co.jp&range=90&width=450&height=200`;

    return (
        <tr className={`hover:bg-slate-50/80 transition-colors ${isProfitable && isMatched ? 'bg-green-50/30' : ''}`}>
            {/* お気に入り */}
            <td className="px-2 py-3 align-top text-center border-r border-slate-200">
                <button onClick={onToggleFavorite} className="inline-block">
                    <Star className={`w-5 h-5 transition-colors ${item.favorite ? 'fill-yellow-400 text-yellow-400' : 'text-slate-300 hover:text-yellow-400'}`} />
                </button>
                <button onClick={onToggleConfirmed} className="inline-block mt-1" title="確認済み">
                    <CheckCircle className={`w-4 h-4 transition-colors ${isConfirmed ? 'text-green-500' : 'text-slate-200 hover:text-green-400'}`} />
                </button>
            </td>
            {/* 商品画像 */}
            <td className="px-3 py-3 align-top border-r border-slate-200">
                {item.rakutenImageUrl && isMatched ? (
                    <img src={item.rakutenImageUrl} alt="" className="w-16 h-16 object-contain rounded border border-slate-200 bg-white cursor-pointer hover:scale-105 transition-transform"
                        onClick={onPreview} />
                ) : (
                    <div className="w-16 h-16 rounded border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-300 text-[10px]">
                        画像なし
                    </div>
                )}
                {isMatched && (
                    <div className="mt-1 text-center">
                        <span className="text-[9px] text-slate-400">類似度</span>
                        <div className={`text-[10px] font-bold ${item.similarityScore >= 0.8 ? 'text-emerald-600' : 'text-blue-600'}`}>
                            {Math.round(item.similarityScore * 100)}%
                        </div>
                    </div>
                )}
            </td>

            {/* ASIN */}
            <td className="px-3 py-3 align-top border-r border-slate-200">
                <div className="font-mono text-[11px] font-bold text-indigo-700">ASIN: {item.asin}</div>
                {item.janCode && (
                    <div className="font-mono text-[11px] font-bold text-emerald-700 mt-0.5">JAN: {item.janCode}</div>
                )}
                {item.monthlySold !== null && item.monthlySold > 0 && (
                    <div className="mt-1.5 inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 text-[11px] font-bold rounded-md border border-blue-200">
                        <span className="text-blue-500 text-[9px]">月間</span>
                        <span className="text-sm">{item.monthlySold}</span>
                        <span className="text-blue-500 text-[9px]">個</span>
                    </div>
                )}
                {item.status === 'PENDING' && (
                    <span className="inline-flex items-center text-[10px] text-blue-500 mt-1">
                        <span className="animate-spin h-2.5 w-2.5 border-2 border-blue-400 rounded-full border-t-transparent mr-0.5" />
                        検索中
                    </span>
                )}
                {item.status === 'NO_MATCH' && (
                    <span className="inline-block mt-1 px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[9px] font-medium rounded">未マッチ</span>
                )}
                {item.status === 'ERROR' && (
                    <span className="inline-block mt-1 px-1.5 py-0.5 bg-red-100 text-red-700 text-[9px] font-medium rounded">エラー</span>
                )}
                {isMatched && (
                    <span className="inline-block mt-1 px-1.5 py-0.5 bg-green-100 text-green-700 text-[9px] font-medium rounded">マッチ</span>
                )}
                {/* メモ欄 */}
                <textarea
                    className="mt-1.5 w-full text-[10px] text-slate-600 border border-slate-200 rounded px-1.5 py-1 resize-none focus:ring-1 focus:ring-indigo-300 outline-none"
                    rows={2}
                    maxLength={200}
                    placeholder="メモを入力（200文字まで）"
                    defaultValue={item.memo || ''}
                    onBlur={(e) => {
                        axios.patch(`/api/compare/${compareId}/items/${item.asin}/memo`, { memo: e.target.value });
                    }}
                />
            </td>

            {/* Keepa チャート */}
            <td className="px-3 py-3 align-top border-r border-slate-200">
                <img
                    src={keepaChartUrl}
                    alt="Keepa"
                    className="w-[280px] h-[130px] object-contain rounded border border-slate-200 bg-white"
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <div className="text-right mt-0.5">
                    <span className="text-[8px] text-slate-400">Keepa</span>
                </div>
            </td>

            {/* 商品名（Amazon + 楽天バッジ） */}
            <td className="px-3 py-3 align-top min-w-[250px] max-w-[350px] border-r border-slate-200">
                {/* Amazon */}
                <div className="mb-2">
                    <span className="inline-block px-1.5 py-0.5 bg-amber-500 text-white text-[9px] font-bold rounded mr-1">Amazon</span>
                    <a href={item.amazonUrl} target="_blank" rel="noopener noreferrer"
                        className="text-[11px] text-blue-600 hover:underline leading-tight line-clamp-2">
                        {item.amazonTitle}
                    </a>
                </div>
                {/* 楽天候補（複数表示） */}
                {isMatched && item.rakutenCandidates && item.rakutenCandidates.length > 0 ? (
                    item.rakutenCandidates.map((candidate, idx) => (
                        <div key={idx} className={`${idx > 0 ? 'mt-1.5 pt-1.5 border-t border-dashed border-slate-200' : ''}`}>
                            <span className="inline-block px-1.5 py-0.5 bg-rose-500 text-white text-[9px] font-bold rounded mr-1">楽天{idx + 1}</span>
                            <span className="text-[10px] text-blue-600 font-medium">{candidate.shopName}</span>
                            <span className="text-[10px] text-slate-400 ml-1">({Math.round(candidate.similarityScore * 100)}%)</span>
                            <a href={candidate.url} target="_blank" rel="noopener noreferrer"
                                className="block text-[10px] text-slate-600 hover:underline leading-tight line-clamp-1 mt-0.5">
                                {candidate.title}
                            </a>
                            <span className="text-[10px] font-bold text-rose-600">{formatCurrency(candidate.price, 'JPY')}</span>
                        </div>
                    ))
                ) : isMatched && item.rakutenTitle ? (
                    <div>
                        <span className="inline-block px-1.5 py-0.5 bg-rose-500 text-white text-[9px] font-bold rounded mr-1">楽天</span>
                        {item.rakutenShop && <span className="text-[10px] text-blue-600 font-medium">{item.rakutenShop}</span>}
                        {item.rakutenUrl ? (
                            <a href={item.rakutenUrl} target="_blank" rel="noopener noreferrer"
                                className="block text-[10px] text-slate-600 hover:underline leading-tight line-clamp-2 mt-0.5">
                                {item.rakutenTitle}
                            </a>
                        ) : (
                            <div className="text-[10px] text-slate-600 line-clamp-2 mt-0.5">{item.rakutenTitle}</div>
                        )}
                    </div>
                ) : !isMatched && item.status !== 'PENDING' ? (
                    <div className="text-[10px] text-slate-400 italic">楽天マッチなし</div>
                ) : null}
            </td>

            {/* 楽天仕入れ価格 */}
            <td className="px-3 py-3 align-top whitespace-nowrap text-right border-r border-slate-200">
                {item.rakutenPrice !== null ? (
                    <div className="text-sm font-bold text-slate-800">{formatCurrency(item.rakutenPrice, 'JPY')}</div>
                ) : (
                    <span className="text-slate-300">-</span>
                )}
            </td>

            {/* Amazon販売価格 */}
            <td className="px-3 py-3 align-top whitespace-nowrap text-right border-r border-slate-200">
                <div className="text-sm font-bold text-slate-800">{formatCurrency(item.amazonPrice, 'JPY')}</div>
            </td>

            {/* Amazon手数料 */}
            <td className="px-3 py-3 align-top whitespace-nowrap text-right border-r border-slate-200">
                <div className="text-sm text-slate-600">{formatCurrency(item.estimatedFee, 'JPY')}</div>
            </td>

            {/* 獲得ポイント */}
            <td className="px-3 py-3 align-top whitespace-nowrap text-right border-r border-slate-200">
                {isMatched && rakutenPoints > 0 ? (
                    <div className="text-sm text-orange-600 font-medium">{formatCurrency(rakutenPoints, 'JPY')}</div>
                ) : (
                    <span className="text-slate-300">-</span>
                )}
            </td>

            {/* 利益 */}
            <td className="px-3 py-3 align-top whitespace-nowrap">
                {isMatched && item.estimatedProfit !== null ? (
                    <div className="text-right space-y-0.5">
                        <div className="text-[10px] text-slate-500">利益（ポイント+現金）</div>
                        <div className={`text-sm font-bold ${isProfitable ? 'text-emerald-600' : 'text-red-500'}`}>
                            {profitWithPoints !== null ? formatCurrency(profitWithPoints, 'JPY') : '-'}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1">利益率</div>
                        <div className={`text-xs font-bold ${
                            (item.profitRate ?? 0) >= 20 ? 'text-emerald-600' :
                            (item.profitRate ?? 0) >= 10 ? 'text-blue-600' :
                            (item.profitRate ?? 0) >= 0 ? 'text-slate-700' : 'text-red-500'
                        }`}>
                            {item.profitRate !== null ? `${item.profitRate}%` : '-'}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1">現金利益</div>
                        <div className={`text-xs font-bold ${isProfitable ? 'text-emerald-600' : 'text-red-500'}`}>
                            {formatCurrency(item.estimatedProfit, 'JPY')}
                        </div>
                    </div>
                ) : (
                    <span className="text-slate-300">-</span>
                )}
            </td>
        </tr>
    );
}

// ===== プレビューモーダル =====
function PreviewModal({ item, onClose }: { item: ComparisonItem; onClose: () => void }) {
    const isProfitable = item.estimatedProfit !== null && item.estimatedProfit > 0;
    const rakutenPoints = item.rakutenPrice ? Math.round(item.rakutenPrice * (item.rakutenPointRate / 100)) : 0;
    const profitWithPoints = item.estimatedProfit !== null ? item.estimatedProfit + rakutenPoints : null;
    const keepaChartUrl = `https://graph.keepa.com/pricehistory.png?asin=${item.asin}&domain=co.jp&range=180&width=700&height=300`;

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 border-b border-slate-200">
                    <h3 className="text-base font-bold text-slate-800">商品詳細プレビュー</h3>
                    <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg transition-colors">
                        <X className="w-5 h-5 text-slate-500" />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    {/* 画像 + 情報 */}
                    <div className="flex gap-4">
                        {item.rakutenImageUrl && (
                            <img src={item.rakutenImageUrl} alt="" className="w-28 h-28 object-contain rounded-lg border border-slate-200 bg-white flex-shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                            <div className="font-mono text-xs text-slate-400 mb-1">{item.asin}</div>
                            <div className="mb-2">
                                <span className="inline-block px-1.5 py-0.5 bg-amber-500 text-white text-[9px] font-bold rounded mr-1">Amazon</span>
                                <span className="text-sm text-slate-800">{item.amazonTitle}</span>
                            </div>
                            {item.rakutenCandidates && item.rakutenCandidates.length > 0 ? (
                                <div className="space-y-1.5">
                                    {item.rakutenCandidates.map((candidate, idx) => (
                                        <div key={idx} className={`${idx > 0 ? 'pt-1.5 border-t border-dashed border-slate-200' : ''}`}>
                                            <span className="inline-block px-1.5 py-0.5 bg-rose-500 text-white text-[9px] font-bold rounded mr-1">楽天{idx + 1}</span>
                                            <span className="text-xs text-blue-600 font-medium">{candidate.shopName}</span>
                                            <span className="text-xs text-slate-400 ml-1">({Math.round(candidate.similarityScore * 100)}%)</span>
                                            <a href={candidate.url} target="_blank" rel="noopener noreferrer"
                                                className="block text-xs text-slate-600 hover:underline leading-tight mt-0.5">
                                                {candidate.title}
                                            </a>
                                            <span className="text-xs font-bold text-rose-600">{formatCurrency(candidate.price, 'JPY')}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : item.rakutenTitle ? (
                                <div>
                                    <span className="inline-block px-1.5 py-0.5 bg-rose-500 text-white text-[9px] font-bold rounded mr-1">楽天</span>
                                    <span className="text-xs text-slate-600">{item.rakutenTitle}</span>
                                    {item.rakutenShop && <span className="text-xs text-slate-400 ml-2">({item.rakutenShop})</span>}
                                </div>
                            ) : null}
                        </div>
                    </div>

                    {/* Keepa チャート */}
                    <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                        <div className="text-xs font-medium text-slate-500 mb-2">Keepa 価格推移（過去180日）</div>
                        <img src={keepaChartUrl} alt="Keepa Chart" className="w-full h-auto rounded" loading="lazy"
                            onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }} />
                    </div>

                    {/* 価格内訳 */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <PriceCard label="楽天仕入れ価格" value={item.rakutenPrice} color="rose" />
                        <PriceCard label="Amazon販売価格" value={item.amazonPrice} color="indigo" />
                        <PriceCard label="Amazon手数料" value={item.estimatedFee} color="slate" />
                        <PriceCard label="獲得ポイント" value={rakutenPoints > 0 ? rakutenPoints : null} color="orange" />
                    </div>

                    {/* 利益 */}
                    {item.estimatedProfit !== null && (
                        <div className={`rounded-xl p-4 border ${isProfitable ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                            <div className="grid grid-cols-3 gap-4 text-center">
                                <div>
                                    <div className="text-[10px] font-medium text-slate-500">利益（ポイント+現金）</div>
                                    <div className={`text-xl font-bold ${isProfitable ? 'text-emerald-700' : 'text-red-700'}`}>
                                        {profitWithPoints !== null ? formatCurrency(profitWithPoints, 'JPY') : '-'}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-medium text-slate-500">利益率</div>
                                    <div className={`text-xl font-bold ${isProfitable ? 'text-emerald-700' : 'text-red-700'}`}>
                                        {item.profitRate !== null ? `${item.profitRate}%` : '-'}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-medium text-slate-500">現金利益</div>
                                    <div className={`text-xl font-bold ${isProfitable ? 'text-emerald-700' : 'text-red-700'}`}>
                                        {formatCurrency(item.estimatedProfit, 'JPY')}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* リンク */}
                    <div className="flex gap-3">
                        <a href={item.amazonUrl} target="_blank" rel="noopener noreferrer"
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors text-sm font-medium">
                            <ExternalLink className="w-4 h-4" /> Amazonで見る
                        </a>
                        {item.rakutenUrl && (
                            <a href={item.rakutenUrl} target="_blank" rel="noopener noreferrer"
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-500 text-white rounded-lg hover:bg-rose-600 transition-colors text-sm font-medium">
                                <ExternalLink className="w-4 h-4" /> 楽天で見る
                            </a>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function PriceCard({ label, value, color }: { label: string; value: number | null; color: string }) {
    const colorMap: Record<string, string> = {
        rose: 'bg-rose-50 border-rose-100 text-rose-700',
        indigo: 'bg-indigo-50 border-indigo-100 text-indigo-700',
        slate: 'bg-slate-50 border-slate-100 text-slate-700',
        orange: 'bg-orange-50 border-orange-100 text-orange-700',
    };
    return (
        <div className={`rounded-lg p-3 border text-center ${colorMap[color] || colorMap.slate}`}>
            <div className="text-[10px] font-medium opacity-70 mb-0.5">{label}</div>
            <div className="text-base font-bold">{value !== null ? formatCurrency(value, 'JPY') : '-'}</div>
        </div>
    );
}

export default ComparePage;
