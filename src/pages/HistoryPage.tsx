import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { Clock, ChevronRight, BarChart2 } from 'lucide-react';
import { RunSummary } from '../types';

const HistoryPage: React.FC = () => {
    const [history, setHistory] = useState<RunSummary[]>([]);

    useEffect(() => {
        axios.get('/api/history').then(res => setHistory(res.data));
    }, []);

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center gap-3 mb-6">
                <HistoryIcon className="w-8 h-8 text-slate-700" />
                <h2 className="text-2xl font-bold text-slate-800">実行履歴</h2>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                {history.length === 0 ? (
                    <div className="p-8 text-center text-slate-400">
                        履歴がありません。最初のインポートを開始してください。
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {history.map((run) => (
                            <Link
                                key={run.id}
                                to={`/results/${run.id}`}
                                className="block p-6 hover:bg-slate-50 transition-colors"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-start gap-4">
                                        <div className="bg-blue-50 p-3 rounded-lg">
                                            <BarChart2 className="w-6 h-6 text-amazon-blue" />
                                        </div>
                                        <div>
                                            <div className="font-medium text-slate-900">Run ID: {run.id.slice(0, 8)}...</div>
                                            <div className="text-sm text-slate-500 flex items-center mt-1">
                                                <Clock className="w-3 h-3 mr-1" />
                                                {new Date(run.createdAt).toLocaleString()}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="text-right">
                                            <div className="text-2xl font-bold text-slate-800">{run.processed} / {run.total}</div>
                                            <div className="text-xs text-slate-500 uppercase tracking-wide">処理済み</div>
                                        </div>
                                        <ChevronRight className="w-5 h-5 text-slate-300" />
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

function HistoryIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M12 7v5l4 2" />
        </svg>
    );
}

export default HistoryPage;
