import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import {
    Clock, ChevronRight, BarChart2, GitCompareArrows,
    Search, Loader2, Database
} from 'lucide-react';

interface HistoryEntry {
    id: string;
    type: 'run' | 'comparison';
    createdAt: number;
    asinCount: number;
    isRunning: boolean;
    fromDB?: boolean;
    // run固有
    processed?: number;
    success?: number;
    failed?: number;
    // comparison固有
    runId?: string;
    matched?: number;
    profitable?: number;
}

const HistoryPage: React.FC = () => {
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [typeFilter, setTypeFilter] = useState<'all' | 'run' | 'comparison'>('all');

    useEffect(() => {
        axios.get('/api/history').then(res => {
            setHistory(res.data);
            setLoading(false);
        }).catch(() => setLoading(false));
    }, []);

    const filtered = history.filter(entry => {
        if (typeFilter !== 'all' && entry.type !== typeFilter) return false;
        if (search && !entry.id.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
    });

    const formatDate = (ts: number) => {
        const d = new Date(ts);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const diffMin = Math.floor(diffMs / 60000);
        const diffHour = Math.floor(diffMs / 3600000);
        const diffDay = Math.floor(diffMs / 86400000);

        let relative = '';
        if (diffMin < 1) relative = 'たった今';
        else if (diffMin < 60) relative = `${diffMin}分前`;
        else if (diffHour < 24) relative = `${diffHour}時間前`;
        else if (diffDay < 7) relative = `${diffDay}日前`;
        else relative = d.toLocaleDateString('ja-JP');

        return { full: d.toLocaleString('ja-JP'), relative };
    };

    if (loading) {
        return (
            <div className="flex justify-center p-20">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            {/* ヘッダー */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="bg-indigo-50 p-2.5 rounded-lg">
                        <Clock className="w-6 h-6 text-indigo-600" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800">検索履歴</h2>
                        <p className="text-sm text-slate-500">過去の価格チェック・楽天比較の結果を確認できます</p>
                    </div>
                </div>
                <div className="text-sm text-slate-500">
                    合計 {history.length} 件
                </div>
            </div>

            {/* フィルター */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                        type="text"
                        placeholder="IDで検索..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none text-sm"
                    />
                </div>
                <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
                    {[
                        { key: 'all' as const, label: 'すべて' },
                        { key: 'run' as const, label: '価格チェック' },
                        { key: 'comparison' as const, label: '楽天比較' },
                    ].map(f => (
                        <button
                            key={f.key}
                            onClick={() => setTypeFilter(f.key)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                                typeFilter === f.key
                                    ? 'bg-white text-indigo-700 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* 履歴一覧 */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                {filtered.length === 0 ? (
                    <div className="p-12 text-center text-slate-400">
                        <Clock className="w-12 h-12 mx-auto mb-3 text-slate-200" />
                        <p className="text-lg font-medium">履歴がありません</p>
                        <p className="text-sm mt-1">価格チェックまたは楽天比較を実行すると、ここに表示されます</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {filtered.map(entry => {
                            const date = formatDate(entry.createdAt);
                            const isRun = entry.type === 'run';
                            const linkTo = isRun
                                ? `/results/${entry.id}`
                                : `/compare/${entry.id}`;

                            return (
                                <Link
                                    key={`${entry.type}-${entry.id}`}
                                    to={linkTo}
                                    className="block p-5 hover:bg-slate-50 transition-colors"
                                >
                                    <div className="flex items-center gap-4">
                                        {/* アイコン */}
                                        <div className={`p-3 rounded-lg flex-shrink-0 ${
                                            isRun ? 'bg-blue-50' : 'bg-purple-50'
                                        }`}>
                                            {isRun ? (
                                                <BarChart2 className="w-5 h-5 text-blue-600" />
                                            ) : (
                                                <GitCompareArrows className="w-5 h-5 text-purple-600" />
                                            )}
                                        </div>

                                        {/* メイン情報 */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                {/* 種別バッジ */}
                                                <span className={`px-2 py-0.5 text-[10px] font-bold rounded ${
                                                    isRun
                                                        ? 'bg-blue-100 text-blue-700'
                                                        : 'bg-purple-100 text-purple-700'
                                                }`}>
                                                    {isRun ? '価格チェック' : '楽天比較'}
                                                </span>

                                                {/* ステータス */}
                                                {entry.isRunning ? (
                                                    <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-amber-100 text-amber-700 flex items-center gap-1">
                                                        <Loader2 className="w-2.5 h-2.5 animate-spin" /> 処理中
                                                    </span>
                                                ) : (
                                                    <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-green-100 text-green-700">
                                                        完了
                                                    </span>
                                                )}

                                                {/* DB保存済み */}
                                                {entry.fromDB && (
                                                    <span className="px-1.5 py-0.5 text-[9px] font-medium rounded bg-slate-100 text-slate-500 flex items-center gap-0.5">
                                                        <Database className="w-2.5 h-2.5" /> 保存済み
                                                    </span>
                                                )}
                                            </div>

                                            {/* ID + 日時 */}
                                            <div className="flex items-center gap-3 text-xs text-slate-500">
                                                <span className="font-mono">{entry.id.slice(0, 8)}...</span>
                                                <span className="flex items-center gap-1">
                                                    <Clock className="w-3 h-3" />
                                                    <span title={date.full}>{date.relative}</span>
                                                </span>
                                            </div>
                                        </div>

                                        {/* 統計情報 */}
                                        <div className="flex items-center gap-4 flex-shrink-0">
                                            {isRun ? (
                                                <>
                                                    <div className="text-center">
                                                        <div className="text-xl font-bold text-slate-800">{entry.asinCount}</div>
                                                        <div className="text-[10px] text-slate-400">ASIN数</div>
                                                    </div>
                                                    <div className="text-center">
                                                        <div className="text-lg font-bold text-green-600">{entry.success || 0}</div>
                                                        <div className="text-[10px] text-slate-400">成功</div>
                                                    </div>
                                                    {(entry.failed || 0) > 0 && (
                                                        <div className="text-center">
                                                            <div className="text-lg font-bold text-red-500">{entry.failed}</div>
                                                            <div className="text-[10px] text-slate-400">失敗</div>
                                                        </div>
                                                    )}
                                                </>
                                            ) : (
                                                <>
                                                    <div className="text-center">
                                                        <div className="text-xl font-bold text-slate-800">{entry.asinCount}</div>
                                                        <div className="text-[10px] text-slate-400">商品数</div>
                                                    </div>
                                                    <div className="text-center">
                                                        <div className="text-lg font-bold text-blue-600">{entry.matched || 0}</div>
                                                        <div className="text-[10px] text-slate-400">マッチ</div>
                                                    </div>
                                                    <div className="text-center">
                                                        <div className="text-lg font-bold text-emerald-600">{entry.profitable || 0}</div>
                                                        <div className="text-[10px] text-slate-400">利益商品</div>
                                                    </div>
                                                </>
                                            )}
                                        </div>

                                        <ChevronRight className="w-5 h-5 text-slate-300 flex-shrink-0" />
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default HistoryPage;
