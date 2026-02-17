import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Papa from 'papaparse';
import { Upload, FileText, AlertCircle, Loader2, Info, Search as SearchIcon, CheckSquare, Square as SquareIcon, GitCompareArrows, Zap, FileUp, PenLine, Filter } from 'lucide-react';
import axios from 'axios';
import { OriginalCsvData, OriginalRowData } from '../types';

const ASIN_COLUMN_PATTERNS = [
    'asin',
    '備考（asin）',
    '備考(asin)',
    '備考',
    'remarks',
    'asin code',
    'asincode',
    'amazon asin',
    'amazonasin',
    'product id',
    'productid',
];

const PRICE_COLUMN_PATTERNS = [
    '想定販売価格',
    '販売価格',
    'selling price',
    'sellingprice',
    'price',
    '価格',
];

const isAsinColumn = (columnName: string): boolean => {
    const normalized = columnName.toLowerCase().trim();
    return ASIN_COLUMN_PATTERNS.some(pattern => normalized.includes(pattern));
};

const isPriceColumn = (columnName: string): boolean => {
    const normalized = columnName.toLowerCase().trim();
    return PRICE_COLUMN_PATTERNS.some(pattern => normalized.includes(pattern));
};

const isValidAsin = (value: string | undefined): boolean => {
    if (!value) return false;
    const trimmed = value.trim();
    return /^[A-Z0-9]{10}$/i.test(trimmed);
};

interface PreviewRow {
    rowNum: number;
    asin: string;
    extraInfo?: string;
}

const ImportPage: React.FC = () => {
    const navigate = useNavigate();

    const [isDragging, setIsDragging] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [preview, setPreview] = useState<PreviewRow[]>([]);
    const [stats, setStats] = useState({ total: 0, unique: 0, duplicates: 0, empty: 0 });
    const [detectedAsinColumn, setDetectedAsinColumn] = useState<string | null>(null);
    const [detectedPriceColumn, setDetectedPriceColumn] = useState<string | null>(null);

    const [originalCsvData, setOriginalCsvData] = useState<OriginalCsvData | null>(null);

    // タブ state
    const [activeTab, setActiveTab] = useState<'csv' | 'text' | 'keepa' | 'query'>('csv');

    // テキスト入力用
    const [textInput, setTextInput] = useState('');
    const [textPreview, setTextPreview] = useState<PreviewRow[]>([]);
    const [textStats, setTextStats] = useState({ total: 0, unique: 0, duplicates: 0, empty: 0 });
    const [textAsins, setTextAsins] = useState<string[]>([]);

    // Keepaクエリ用
    const [queryUrl, setQueryUrl] = useState('');
    const [queryExecuting, setQueryExecuting] = useState(false);
    const [queryResults, setQueryResults] = useState<string[]>([]);
    const [queryTotalResults, setQueryTotalResults] = useState(0);
    const [queryError, setQueryError] = useState('');
    const [querySelection, setQuerySelection] = useState<any>(null);
    const [querySelectedAsins, setQuerySelectedAsins] = useState<Set<string>>(new Set());
    const [querySelectCount, setQuerySelectCount] = useState('');
    const [queryTokenBudget, setQueryTokenBudget] = useState('');
    const [queryTokensInfo, setQueryTokensInfo] = useState<{ left: number; consumed: number } | null>(null);

    // Keepa検索用
    const [keepaKeyword, setKeepaKeyword] = useState('');
    const [keepaSearching, setKeepaSearching] = useState(false);
    const [keepaResults, setKeepaResults] = useState<Array<{ asin: string; title: string | null; price: number | null; currency: string; selected: boolean }>>([]);
    const [keepaError, setKeepaError] = useState('');

    const processTextInput = (text: string) => {
        setTextInput(text);
        // 改行、カンマ、スペース、タブで分割
        const raw = text.split(/[\n,\s\t]+/).map(s => s.trim()).filter(Boolean);
        const valid: string[] = [];
        const seen = new Set<string>();
        let empty = 0;

        raw.forEach(val => {
            if (isValidAsin(val)) {
                valid.push(val);
                seen.add(val);
            } else {
                empty++;
            }
        });

        const unique = Array.from(seen);
        setTextAsins(unique);
        setTextStats({ total: raw.length, unique: unique.length, duplicates: valid.length - unique.length, empty });
        setTextPreview(unique.slice(0, 5).map((asin, i) => ({ rowNum: i + 1, asin })));
    };

    const handleKeepaSearch = async () => {
        if (!keepaKeyword.trim()) return;
        setKeepaSearching(true);
        setKeepaError('');
        setKeepaResults([]);
        try {
            const res = await axios.get('/api/keepa-search', { params: { keyword: keepaKeyword.trim() } });
            setKeepaResults(res.data.products.map((p: any) => ({
                asin: p.asin,
                title: p.title,
                price: p.price,
                currency: p.currency,
                selected: true,
            })));
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: string } } };
            setKeepaError(error.response?.data?.error || 'Keepa検索に失敗しました');
        }
        setKeepaSearching(false);
    };

    const toggleKeepaSelect = (asin: string) => {
        setKeepaResults(prev => prev.map(r => r.asin === asin ? { ...r, selected: !r.selected } : r));
    };

    const toggleKeepaSelectAll = () => {
        const allSelected = keepaResults.every(r => r.selected);
        setKeepaResults(prev => prev.map(r => ({ ...r, selected: !allSelected })));
    };

    const handleStartFromText = async (autoCompare: boolean = false) => {
        if (textAsins.length === 0) return;
        setIsLoading(true);
        try {
            const res = await axios.post('/api/runs', { asins: textAsins });
            const url = autoCompare
                ? `/results/${res.data.runId}?autoCompare=true`
                : `/results/${res.data.runId}`;
            navigate(url);
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: string } } };
            setError(error.response?.data?.error || '処理開始に失敗しました');
            setIsLoading(false);
        }
    };

    const handleStartFromKeepa = async (autoCompare: boolean = false) => {
        const selected = keepaResults.filter(r => r.selected);
        if (selected.length === 0) return;
        setIsLoading(true);
        try {
            const res = await axios.post('/api/runs', { asins: selected.map(r => r.asin) });
            const url = autoCompare
                ? `/results/${res.data.runId}?autoCompare=true`
                : `/results/${res.data.runId}`;
            navigate(url);
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: string } } };
            setError(error.response?.data?.error || '処理開始に失敗しました');
            setIsLoading(false);
        }
    };

    const handleKeepaQuery = async () => {
        if (!queryUrl.trim()) return;
        setQueryExecuting(true);
        setQueryError('');
        setQueryResults([]);
        setQuerySelection(null);
        setQuerySelectedAsins(new Set());
        setQuerySelectCount('');
        setQueryTokensInfo(null);
        try {
            const budget = parseInt(queryTokenBudget, 10);
            const payload: any = { queryUrl: queryUrl.trim() };
            if (budget > 0) payload.tokenBudget = budget;
            const res = await axios.post('/api/keepa-query', payload);
            const asins: string[] = res.data.asinList;
            setQueryResults(asins);
            setQueryTotalResults(res.data.totalResults);
            setQuerySelection(res.data.selection);
            setQueryTokensInfo({ left: res.data.tokensLeft || 0, consumed: res.data.tokensConsumed || 0 });
            // デフォルトは全選択
            setQuerySelectedAsins(new Set(asins));
            // トークン不足で全件取得できなかった場合の注意
            if (res.data.totalResults > res.data.returnedCount) {
                setQueryError(`注意: 合計${res.data.totalResults.toLocaleString()}件中、${res.data.returnedCount.toLocaleString()}件のみ取得されました。${res.data.warning ? res.data.warning : 'トークン回復後に再実行すると追加取得できます。'}`);
            }
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: string } } };
            setQueryError(error.response?.data?.error || 'クエリ実行に失敗しました');
        }
        setQueryExecuting(false);
    };

    const handleStartFromQuery = async (autoCompare: boolean = false) => {
        const selected = queryResults.filter(a => querySelectedAsins.has(a));
        if (selected.length === 0) return;
        setIsLoading(true);
        try {
            const res = await axios.post('/api/runs', { asins: selected });
            const url = autoCompare
                ? `/results/${res.data.runId}?autoCompare=true`
                : `/results/${res.data.runId}`;
            navigate(url);
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: string } } };
            setError(error.response?.data?.error || '処理開始に失敗しました');
            setIsLoading(false);
        }
    };

    const toggleQueryAsin = (asin: string) => {
        setQuerySelectedAsins(prev => {
            const next = new Set(prev);
            if (next.has(asin)) next.delete(asin); else next.add(asin);
            return next;
        });
    };

    const querySelectAll = () => setQuerySelectedAsins(new Set(queryResults));
    const queryDeselectAll = () => setQuerySelectedAsins(new Set());
    const querySelectFirstN = (n: number) => {
        setQuerySelectedAsins(new Set(queryResults.slice(0, n)));
        setQuerySelectCount(String(n));
    };

    const processFile = (uploadedFile: File) => {
        setFile(uploadedFile);
        setError(null);
        setDetectedAsinColumn(null);
        setDetectedPriceColumn(null);
        setOriginalCsvData(null);

        Papa.parse(uploadedFile, {
            header: false,
            skipEmptyLines: true,
            complete: (rawResults) => {
                let rawRows = rawResults.data as string[][];

                // 先頭の空行をスキップして実際のヘッダー行を見つける
                let headerRowIndex = 0;
                while (headerRowIndex < rawRows.length) {
                    const row = rawRows[headerRowIndex];
                    const hasContent = row.some(cell => cell && cell.trim().length > 0);
                    if (hasContent) break;
                    headerRowIndex++;
                }

                if (headerRowIndex >= rawRows.length) {
                    setError('CSVファイルにデータが見つかりません。');
                    setFile(null);
                    return;
                }

                // ヘッダー行を取得
                const rawHeaders = rawRows[headerRowIndex].map(h => h.trim());
                const dataRows = rawRows.slice(headerRowIndex + 1);

                // Record形式に変換
                const headers = rawHeaders.filter(h => h.length > 0);
                const rows: Record<string, string>[] = dataRows
                    .filter(row => row.some(cell => cell && cell.trim().length > 0))
                    .map(row => {
                        const obj: Record<string, string> = {};
                        rawHeaders.forEach((header, i) => {
                            if (header.length > 0) {
                                obj[header] = (row[i] || '').trim();
                            }
                        });
                        return obj;
                    });

                if (headers.length === 0) {
                    setError('CSVファイルにヘッダーが見つかりません。');
                    setFile(null);
                    return;
                }

                // ASIN列を検出
                let asinColumnKey: string | null = null;
                for (const header of headers) {
                    if (isAsinColumn(header)) {
                        asinColumnKey = header;
                        break;
                    }
                }

                // 明示的なASIN列が見つからない場合、値からASIN列を推測
                if (!asinColumnKey) {
                    let bestColumn: string | null = null;
                    let bestCount = 0;

                    for (const header of headers) {
                        const validCount = rows.filter(row => isValidAsin(row[header])).length;
                        if (validCount > bestCount) {
                            bestCount = validCount;
                            bestColumn = header;
                        }
                    }

                    // 10%以上の行がASINなら採用（閾値を下げて検出率向上）
                    if (bestColumn && bestCount >= Math.max(1, rows.length * 0.1)) {
                        asinColumnKey = bestColumn;
                    }
                }

                // ヘッダー自体がASINの場合（ヘッダーなしCSV）→ ヘッダーを含めて再パース
                if (!asinColumnKey) {
                    for (const header of headers) {
                        if (isValidAsin(header)) {
                            // ヘッダーなしCSVを再パース
                            Papa.parse(uploadedFile, {
                                header: false,
                                skipEmptyLines: true,
                                complete: (noHeaderResults) => {
                                    const noHeaderRows = noHeaderResults.data as string[][];
                                    const validAsins: string[] = [];
                                    const seenAsins = new Set<string>();
                                    const validRowData: OriginalRowData[] = [];

                                    noHeaderRows.forEach((row, index) => {
                                        // 各行の各列からASINを探す
                                        for (const cell of row) {
                                            const trimmed = cell?.trim();
                                            if (isValidAsin(trimmed)) {
                                                validAsins.push(trimmed);
                                                if (!seenAsins.has(trimmed)) {
                                                    seenAsins.add(trimmed);
                                                    const rowObj: Record<string, string> = {};
                                                    row.forEach((v, ci) => { rowObj[`col${ci}`] = v; });
                                                    validRowData.push({ rowIndex: index, originalRow: rowObj, asin: trimmed });
                                                }
                                                break;
                                            }
                                        }
                                    });

                                    if (seenAsins.size === 0) {
                                        setError('ASIN列が見つかりません。「asin」「備考（ASIN）」などの列ヘッダーを含むCSVファイルをアップロードしてください。');
                                        setFile(null);
                                        return;
                                    }

                                    setDetectedAsinColumn('自動検出（ヘッダーなし）');
                                    setStats({ total: noHeaderRows.length, unique: seenAsins.size, duplicates: validAsins.length - seenAsins.size, empty: noHeaderRows.length - validAsins.length });
                                    setPreview(validRowData.slice(0, 5).map(r => ({ rowNum: r.rowIndex + 1, asin: r.asin })));
                                    setOriginalCsvData({ headers: ['ASIN'], asinColumn: 'ASIN', priceColumn: null, rows: validRowData });
                                },
                            });
                            return; // 再パース中なのでここで抜ける
                        }
                    }
                }

                // 1列しかないCSVの場合、その列を使う
                if (!asinColumnKey && headers.length === 1) {
                    const onlyHeader = headers[0];
                    const validCount = rows.filter(row => isValidAsin(row[onlyHeader])).length;
                    if (validCount >= 1) {
                        asinColumnKey = onlyHeader;
                    }
                }

                if (!asinColumnKey) {
                    setError('ASIN列が見つかりません。「asin」「備考（ASIN）」などの列ヘッダーを含むCSVファイルをアップロードしてください。');
                    setFile(null);
                    return;
                }

                setDetectedAsinColumn(asinColumnKey);

                // 価格列を検出
                let priceColumnKey: string | null = null;
                for (const header of headers) {
                    if (isPriceColumn(header)) {
                        priceColumnKey = header;
                        break;
                    }
                }
                setDetectedPriceColumn(priceColumnKey);

                // 有効なASINを抽出
                const validRows: OriginalRowData[] = [];
                const allAsins: string[] = [];
                const seenAsins = new Set<string>();
                let emptyCount = 0;

                rows.forEach((row, index) => {
                    const asinValue = row[asinColumnKey!]?.trim();

                    if (!asinValue) {
                        emptyCount++;
                        return;
                    }

                    if (!isValidAsin(asinValue)) {
                        emptyCount++;
                        return;
                    }

                    allAsins.push(asinValue);

                    if (!seenAsins.has(asinValue)) {
                        seenAsins.add(asinValue);
                        validRows.push({
                            rowIndex: index,
                            originalRow: row,
                            asin: asinValue,
                        });
                    }
                });

                setStats({
                    total: rows.length,
                    unique: seenAsins.size,
                    duplicates: allAsins.length - seenAsins.size,
                    empty: emptyCount,
                });

                const previewData: PreviewRow[] = validRows.slice(0, 5).map((r) => {
                    const modelInfo = r.originalRow['型番（記号）'] || r.originalRow['Model'] || '';
                    const modelNum = r.originalRow['型番（数字）'] || '';
                    const brand = r.originalRow['Brand'] || r.originalRow['ブランド名'] || '';

                    let extraInfo = '';
                    if (modelInfo || modelNum || brand) {
                        extraInfo = [brand, modelInfo, modelNum].filter(Boolean).join(' ');
                    }

                    return {
                        rowNum: r.rowIndex + 1,
                        asin: r.asin,
                        extraInfo: extraInfo || undefined,
                    };
                });
                setPreview(previewData);

                setOriginalCsvData({
                    headers,
                    asinColumn: asinColumnKey!,
                    priceColumn: priceColumnKey,
                    rows: validRows,
                });
            },
            error: (err) => {
                setError(`CSVの解析に失敗しました: ${err.message}`);
                setFile(null);
            },
        });
    };

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const droppedFile = e.dataTransfer.files[0];
        if (droppedFile?.type === 'text/csv' || droppedFile?.name.endsWith('.csv')) {
            processFile(droppedFile);
        } else {
            setError('CSVファイルをアップロードしてください。');
        }
    }, []);

    const handleStart = async (autoCompare: boolean = false) => {
        if (!file || !originalCsvData) return;
        setIsLoading(true);

        try {
            const asins = originalCsvData.rows.map(r => r.asin);
            const res = await axios.post('/api/runs', {
                asins,
                originalCsvData: {
                    headers: originalCsvData.headers,
                    asinColumn: originalCsvData.asinColumn,
                    priceColumn: originalCsvData.priceColumn,
                    rows: originalCsvData.rows,
                },
            });
            const url = autoCompare
                ? `/results/${res.data.runId}?autoCompare=true`
                : `/results/${res.data.runId}`;
            navigate(url);
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: string } } };
            setError(error.response?.data?.error || 'サーバーでの処理開始に失敗しました。');
            setIsLoading(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto space-y-8">
            <div className="text-center space-y-2">
                <h2 className="text-3xl font-bold text-slate-800">楽天 × Amazon 価格比較</h2>
                <p className="text-slate-500">ASINを登録して楽天仕入れ × Amazon販売の利益シミュレーションを行います</p>
            </div>

            {/* タブ切替 */}
            <div className="flex border-b border-slate-200">
                {[
                    { key: 'csv' as const, label: 'CSVアップロード', Icon: FileUp },
                    { key: 'text' as const, label: 'テキスト入力', Icon: PenLine },
                    { key: 'keepa' as const, label: 'Keepa検索', Icon: SearchIcon },
                    { key: 'query' as const, label: 'Keepaクエリ', Icon: Filter },
                ].map(tab => (
                    <button key={tab.key} onClick={() => { setActiveTab(tab.key); setError(null); }}
                        className={`flex items-center gap-1.5 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                            activeTab === tab.key
                                ? 'border-indigo-500 text-indigo-600'
                                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                        }`}>
                        <tab.Icon className="w-4 h-4" /> {tab.label}
                    </button>
                ))}
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg flex items-center gap-3">
                    <AlertCircle className="w-5 h-5" />
                    <p>{error}</p>
                </div>
            )}

            {/* === CSVタブ === */}
            {activeTab === 'csv' && (
                <>
                    <div className="bg-blue-50 border border-blue-200 text-blue-700 p-4 rounded-lg flex items-start gap-3">
                        <Info className="w-5 h-5 mt-0.5 flex-shrink-0" />
                        <div className="text-sm">
                            <p className="font-medium mb-1">対応するASIN列名:</p>
                            <p className="text-blue-600">
                                asin, ASIN, 備考（ASIN）, 備考, remarks など
                            </p>
                            <p className="mt-2">
                                価格は「想定販売価格」列に反映されるか、新しい列として追加されます。
                            </p>
                        </div>
                    </div>

                    <div
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                        className={`
                            relative border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer
                            ${isDragging ? 'border-amazon-blue bg-blue-50 scale-[1.02]' : 'border-slate-300 hover:border-slate-400 bg-white'}
                        `}
                    >
                        <input
                            type="file"
                            accept=".csv"
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])}
                        />

                        <div className="flex flex-col items-center gap-4">
                            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center">
                                <Upload className="w-8 h-8 text-slate-400" />
                            </div>
                            <div>
                                <p className="text-lg font-medium text-slate-700">
                                    {file ? file.name : "ここにCSVをドラッグ&ドロップ"}
                                </p>
                                <p className="text-sm text-slate-400 mt-1">
                                    {file ? `${(file.size / 1024).toFixed(1)} KB` : "またはクリックしてファイルを選択"}
                                </p>
                            </div>
                        </div>
                    </div>

                    {file && !error && originalCsvData && (
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                            {detectedAsinColumn && (
                                <div className="px-6 py-3 bg-green-50 border-b border-green-100 text-sm text-green-700">
                                    <span className="font-medium">検出されたASIN列:</span> 「{detectedAsinColumn}」
                                    {detectedPriceColumn && (
                                        <span className="ml-4">
                                            <span className="font-medium">価格列:</span> 「{detectedPriceColumn}」
                                        </span>
                                    )}
                                </div>
                            )}

                            <div className="p-6 border-b border-slate-100 grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="text-center">
                                    <div className="text-sm text-slate-500">総行数</div>
                                    <div className="text-2xl font-bold text-slate-800">{stats.total}</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-sm text-slate-500">有効ASIN数</div>
                                    <div className="text-2xl font-bold text-amazon-blue">{stats.unique}</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-sm text-slate-500">重複</div>
                                    <div className="text-xl font-semibold text-orange-500">{stats.duplicates}</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-sm text-slate-500">無効/空</div>
                                    <div className="text-xl font-semibold text-red-500">{stats.empty}</div>
                                </div>
                            </div>

                            <div className="p-6 bg-slate-50">
                                <h4 className="text-sm font-semibold text-slate-600 mb-3 flex items-center gap-2">
                                    <FileText className="w-4 h-4" /> CSVプレビュー（最初の5件）
                                </h4>
                                <div className="bg-white border rounded-md overflow-hidden">
                                    <table className="w-full text-sm text-left">
                                        <thead className="bg-slate-100 text-slate-600">
                                            <tr>
                                                <th className="px-4 py-2 font-medium">行番号</th>
                                                <th className="px-4 py-2 font-medium">ASIN</th>
                                                <th className="px-4 py-2 font-medium">商品情報</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {preview.map((row) => (
                                                <tr key={row.rowNum}>
                                                    <td className="px-4 py-2 text-slate-400">{row.rowNum}</td>
                                                    <td className="px-4 py-2 font-mono text-slate-700">{row.asin}</td>
                                                    <td className="px-4 py-2 text-slate-500 truncate max-w-[200px]" title={row.extraInfo}>
                                                        {row.extraInfo || '-'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="mt-6 flex items-center justify-end gap-3">
                                    <button
                                        onClick={() => handleStart(true)}
                                        disabled={isLoading || stats.unique === 0}
                                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-10 py-3.5 rounded-lg font-bold shadow-md transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-base"
                                    >
                                        {isLoading ? (
                                            <>
                                                <Loader2 className="w-5 h-5 animate-spin" /> 処理開始中...
                                            </>
                                        ) : (
                                            <>
                                                <GitCompareArrows className="w-5 h-5" /> 楽天 × Amazon 価格比較を開始
                                            </>
                                        )}
                                    </button>
                                    <button
                                        onClick={() => handleStart(false)}
                                        disabled={isLoading || stats.unique === 0}
                                        className="text-slate-400 hover:text-slate-600 px-3 py-1.5 text-xs transition-all flex items-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed"
                                    >
                                        <Zap className="w-3 h-3" /> Amazonカート価格のみ
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* === テキストタブ === */}
            {activeTab === 'text' && (
                <div className="space-y-4">
                    <div className="bg-blue-50 border border-blue-200 text-blue-700 p-4 rounded-lg flex items-start gap-3">
                        <Info className="w-5 h-5 mt-0.5 flex-shrink-0" />
                        <div className="text-sm">
                            <p className="font-medium mb-1">ASINを入力してください:</p>
                            <p className="text-blue-600">1行に1つのASIN、またはカンマ・スペース区切りで入力できます。</p>
                        </div>
                    </div>

                    <textarea
                        value={textInput}
                        onChange={e => processTextInput(e.target.value)}
                        placeholder={"B09LHDNJ2J\nB0936CSHGD\nB0C4KJ28GB\n...\n\nまたは: B09LHDNJ2J, B0936CSHGD, B0C4KJ28GB"}
                        rows={10}
                        className="w-full px-4 py-3 border border-slate-300 rounded-xl font-mono text-sm focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none resize-y"
                    />

                    {textAsins.length > 0 && (
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                            <div className="p-6 border-b border-slate-100 grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="text-center">
                                    <div className="text-sm text-slate-500">入力数</div>
                                    <div className="text-2xl font-bold text-slate-800">{textStats.total}</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-sm text-slate-500">有効ASIN</div>
                                    <div className="text-2xl font-bold text-indigo-600">{textStats.unique}</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-sm text-slate-500">重複</div>
                                    <div className="text-xl font-semibold text-orange-500">{textStats.duplicates}</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-sm text-slate-500">無効</div>
                                    <div className="text-xl font-semibold text-red-500">{textStats.empty}</div>
                                </div>
                            </div>

                            <div className="p-6 bg-slate-50">
                                <h4 className="text-sm font-semibold text-slate-600 mb-3 flex items-center gap-2">
                                    <FileText className="w-4 h-4" /> プレビュー（最初の5件）
                                </h4>
                                <div className="bg-white border rounded-md overflow-hidden">
                                    <table className="w-full text-sm text-left">
                                        <thead className="bg-slate-100 text-slate-600">
                                            <tr>
                                                <th className="px-4 py-2 font-medium">#</th>
                                                <th className="px-4 py-2 font-medium">ASIN</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {textPreview.map(row => (
                                                <tr key={row.rowNum}>
                                                    <td className="px-4 py-2 text-slate-400">{row.rowNum}</td>
                                                    <td className="px-4 py-2 font-mono text-slate-700">{row.asin}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="mt-6 flex items-center justify-end gap-3">
                                    <button onClick={() => handleStartFromText(true)} disabled={isLoading || textAsins.length === 0}
                                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-10 py-3.5 rounded-lg font-bold shadow-md transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-base">
                                        {isLoading ? <><Loader2 className="w-5 h-5 animate-spin" /> 処理開始中...</> : <><GitCompareArrows className="w-5 h-5" /> 楽天 × Amazon 価格比較を開始</>}
                                    </button>
                                    <button onClick={() => handleStartFromText(false)} disabled={isLoading || textAsins.length === 0}
                                        className="text-slate-400 hover:text-slate-600 px-3 py-1.5 text-xs transition-all flex items-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed">
                                        <Zap className="w-3 h-3" /> Amazonカート価格のみ
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* === Keepa検索タブ === */}
            {activeTab === 'keepa' && (
                <div className="space-y-4">
                    <div className="bg-blue-50 border border-blue-200 text-blue-700 p-4 rounded-lg flex items-start gap-3">
                        <Info className="w-5 h-5 mt-0.5 flex-shrink-0" />
                        <div className="text-sm">
                            <p className="font-medium mb-1">Keepa商品検索:</p>
                            <p className="text-blue-600">キーワードでAmazon商品を検索し、選択した商品のASINで価格チェックを開始します。</p>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input type="text" value={keepaKeyword} onChange={e => setKeepaKeyword(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleKeepaSearch()}
                                placeholder="商品名やキーワードを入力..."
                                className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none text-sm" />
                        </div>
                        <button onClick={handleKeepaSearch} disabled={keepaSearching || !keepaKeyword.trim()}
                            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 flex items-center gap-2">
                            {keepaSearching ? <><Loader2 className="w-4 h-4 animate-spin" /> 検索中...</> : '検索'}
                        </button>
                    </div>

                    {keepaError && (
                        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">{keepaError}</div>
                    )}

                    {keepaResults.length > 0 && (
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                                <span className="text-sm font-medium text-slate-700">
                                    検索結果: {keepaResults.length}件 (選択: {keepaResults.filter(r => r.selected).length}件)
                                </span>
                                <button onClick={toggleKeepaSelectAll} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                                    {keepaResults.every(r => r.selected) ? '全解除' : '全選択'}
                                </button>
                            </div>
                            <div className="max-h-[400px] overflow-y-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-100 text-slate-600 sticky top-0">
                                        <tr>
                                            <th className="px-4 py-2 w-10"></th>
                                            <th className="px-4 py-2 font-medium">ASIN</th>
                                            <th className="px-4 py-2 font-medium">商品名</th>
                                            <th className="px-4 py-2 font-medium">価格</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {keepaResults.map(r => (
                                            <tr key={r.asin} className={`hover:bg-slate-50 cursor-pointer ${r.selected ? 'bg-indigo-50/50' : ''}`}
                                                onClick={() => toggleKeepaSelect(r.asin)}>
                                                <td className="px-4 py-2">
                                                    {r.selected ? (
                                                        <CheckSquare className="w-4 h-4 text-indigo-600" />
                                                    ) : (
                                                        <SquareIcon className="w-4 h-4 text-slate-300" />
                                                    )}
                                                </td>
                                                <td className="px-4 py-2 font-mono text-xs text-slate-700">{r.asin}</td>
                                                <td className="px-4 py-2 text-slate-600 text-xs line-clamp-1 max-w-[300px]">{r.title || '-'}</td>
                                                <td className="px-4 py-2 font-medium text-slate-800 whitespace-nowrap">
                                                    {r.price !== null ? new Intl.NumberFormat('ja-JP', { style: 'currency', currency: r.currency }).format(r.price) : '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div className="p-4 border-t border-slate-200 flex items-center justify-end gap-3">
                                <button onClick={() => handleStartFromKeepa(true)} disabled={isLoading || keepaResults.filter(r => r.selected).length === 0}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-10 py-3.5 rounded-lg font-bold shadow-md transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-base">
                                    {isLoading ? <><Loader2 className="w-5 h-5 animate-spin" /> 処理開始中...</> : <><GitCompareArrows className="w-5 h-5" /> {keepaResults.filter(r => r.selected).length}件で楽天比較開始</>}
                                </button>
                                <button onClick={() => handleStartFromKeepa(false)} disabled={isLoading || keepaResults.filter(r => r.selected).length === 0}
                                    className="text-slate-400 hover:text-slate-600 px-3 py-1.5 text-xs transition-all flex items-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed">
                                    <Zap className="w-3 h-3" /> Amazonカート価格のみ
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* === Keepaクエリタブ === */}
            {activeTab === 'query' && (
                <div className="space-y-4">
                    {/* 説明 */}
                    <div className="bg-blue-50 border border-blue-200 text-blue-700 p-4 rounded-lg flex items-start gap-3">
                        <Info className="w-5 h-5 mt-0.5 flex-shrink-0" />
                        <div className="text-sm">
                            <p className="font-medium mb-1">Keepa Product Finder クエリ:</p>
                            <p className="text-blue-600">
                                KeepaのProduct FinderクエリURLを貼り付けて、条件に合うASINを一括取得します。
                            </p>
                            <p className="text-blue-500 mt-1.5 text-xs">
                                <strong>トークン節約のコツ:</strong> 「取得上限」で件数を制限 → 結果から必要な件数だけ選択 → 「カート価格のみ」で高速チェック。
                                大量件数の場合はKeepa側で「Amazon本体なし」「売上ランク○○位以内」等を絞り込んでからクエリすると効果的です。
                            </p>
                        </div>
                    </div>

                    {/* URL入力 */}
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-slate-700">クエリURL</label>
                        <textarea
                            value={queryUrl}
                            onChange={e => setQueryUrl(e.target.value)}
                            placeholder="https://api.keepa.com/query?key=...&domain=5&selection=..."
                            rows={3}
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl font-mono text-xs focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none resize-y"
                        />
                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleKeepaQuery}
                                disabled={queryExecuting || !queryUrl.trim()}
                                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
                            >
                                {queryExecuting ? (
                                    <><Loader2 className="w-4 h-4 animate-spin" /> クエリ実行中...</>
                                ) : (
                                    'クエリ実行'
                                )}
                            </button>
                            <div className="flex items-center gap-1.5">
                                <span className="text-xs text-slate-500">取得上限:</span>
                                <input
                                    type="number" min="100" step="100"
                                    value={queryTokenBudget}
                                    onChange={e => setQueryTokenBudget(e.target.value)}
                                    placeholder="無制限"
                                    className="w-24 px-2 py-1.5 text-xs border border-slate-300 rounded-md focus:ring-1 focus:ring-indigo-400 outline-none"
                                />
                                <span className="text-xs text-slate-400">件</span>
                            </div>
                        </div>
                        {queryTokensInfo && (
                            <div className="text-xs text-slate-500 flex gap-4">
                                <span>クエリ消費トークン: <strong className="text-slate-700">{queryTokensInfo.consumed}</strong></span>
                                <span>残りトークン: <strong className={queryTokensInfo.left < 100 ? 'text-red-600' : 'text-green-600'}>{queryTokensInfo.left}</strong></span>
                            </div>
                        )}
                    </div>

                    {/* エラー表示 */}
                    {queryError && (
                        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">{queryError}</div>
                    )}

                    {/* 検索条件の表示 */}
                    {querySelection && (
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                            <h4 className="text-sm font-semibold text-slate-700 mb-2">検索条件</h4>
                            <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                                {querySelection.current_SALES_gte !== undefined && (
                                    <div>売上ランク: {querySelection.current_SALES_gte}位 〜 {querySelection.current_SALES_lte || '---'}位</div>
                                )}
                                {querySelection.current_AMAZON_gte !== undefined && (
                                    <div>Amazon本体: {querySelection.current_AMAZON_gte === -1 && querySelection.current_AMAZON_lte === -1 ? '販売なし' : `${querySelection.current_AMAZON_gte}円 〜 ${querySelection.current_AMAZON_lte}円`}</div>
                                )}
                                {querySelection.current_NEW_gte !== undefined && (
                                    <div>新品価格: {querySelection.current_NEW_gte.toLocaleString()}円 〜 {(querySelection.current_NEW_lte || 0).toLocaleString()}円</div>
                                )}
                                {querySelection.current_COUNT_NEW_gte !== undefined && (
                                    <div>新品出品者: {querySelection.current_COUNT_NEW_gte}社以上</div>
                                )}
                                {querySelection.rootCategory && (
                                    <div>カテゴリ: {querySelection.rootCategory.join(', ')}</div>
                                )}
                                {querySelection.perPage !== undefined && (
                                    <div>取得上限: {querySelection.perPage.toLocaleString()}件</div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* 結果表示 + ASIN選択 */}
                    {queryResults.length > 0 && (
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                            {/* ヘッダー */}
                            <div className="px-6 py-4 bg-green-50 border-b border-green-100">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-bold text-green-800">
                                        取得結果: {queryResults.length.toLocaleString()}件のASIN
                                        {queryTotalResults > queryResults.length && (
                                            <span className="text-amber-600 font-normal ml-2">
                                                （合計マッチ: {queryTotalResults.toLocaleString()}件）
                                            </span>
                                        )}
                                    </span>
                                    <span className="text-sm font-bold text-indigo-700">
                                        選択中: {querySelectedAsins.size.toLocaleString()}件
                                    </span>
                                </div>
                            </div>

                            {/* 選択コントロール */}
                            <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 space-y-3">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-medium text-slate-500">一括選択:</span>
                                    <button onClick={querySelectAll}
                                        className="px-3 py-1 text-xs font-medium bg-indigo-100 text-indigo-700 rounded-md hover:bg-indigo-200 transition-colors">
                                        全選択
                                    </button>
                                    <button onClick={queryDeselectAll}
                                        className="px-3 py-1 text-xs font-medium bg-slate-100 text-slate-600 rounded-md hover:bg-slate-200 transition-colors">
                                        全解除
                                    </button>
                                    {[50, 100, 200].filter(n => n < queryResults.length).map(n => (
                                        <button key={n} onClick={() => querySelectFirstN(n)}
                                            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                                                querySelectedAsins.size === n ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                            }`}>
                                            先頭{n}件
                                        </button>
                                    ))}
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium text-slate-500">件数指定:</span>
                                    <input
                                        type="number" min="1" max={queryResults.length}
                                        value={querySelectCount}
                                        onChange={e => {
                                            const val = e.target.value;
                                            setQuerySelectCount(val);
                                            const n = parseInt(val, 10);
                                            if (n > 0) setQuerySelectedAsins(new Set(queryResults.slice(0, Math.min(n, queryResults.length))));
                                        }}
                                        placeholder={`1〜${queryResults.length}`}
                                        className="w-28 px-3 py-1 text-xs border border-slate-300 rounded-md focus:ring-1 focus:ring-indigo-400 focus:border-transparent outline-none"
                                    />
                                    <span className="text-xs text-slate-400">件を選択</span>
                                    <span className="ml-auto text-xs text-amber-600">
                                        推定トークン消費: 約{querySelectedAsins.size * 2}トークン（{querySelectedAsins.size}件）
                                        {queryTokensInfo && queryTokensInfo.left > 0 && (
                                            <span className={querySelectedAsins.size * 2 > queryTokensInfo.left ? ' text-red-600 font-bold' : ''}>
                                                {querySelectedAsins.size * 2 > queryTokensInfo.left
                                                    ? ` | 残量不足（残${queryTokensInfo.left}）`
                                                    : ` | 残量OK（残${queryTokensInfo.left}）`}
                                            </span>
                                        )}
                                    </span>
                                </div>
                            </div>

                            {/* ASIN一覧（スクロール可能） */}
                            <div className="max-h-[300px] overflow-y-auto">
                                <div className="grid grid-cols-4 sm:grid-cols-5 gap-1 p-3">
                                    {queryResults.map((asin, i) => (
                                        <button key={i} onClick={() => toggleQueryAsin(asin)}
                                            className={`font-mono text-xs px-2 py-1.5 rounded text-center transition-colors border ${
                                                querySelectedAsins.has(asin)
                                                    ? 'bg-indigo-50 text-indigo-700 border-indigo-300'
                                                    : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
                                            }`}>
                                            {asin}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* 開始ボタン */}
                            <div className="p-4 border-t border-slate-200 flex items-center justify-end gap-3">
                                <button
                                    onClick={() => handleStartFromQuery(true)}
                                    disabled={isLoading || querySelectedAsins.size === 0}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-10 py-3.5 rounded-lg font-bold shadow-md transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-base"
                                >
                                    {isLoading ? (
                                        <><Loader2 className="w-5 h-5 animate-spin" /> 処理開始中...</>
                                    ) : (
                                        <><GitCompareArrows className="w-5 h-5" /> {querySelectedAsins.size.toLocaleString()}件で楽天比較開始</>
                                    )}
                                </button>
                                <button
                                    onClick={() => handleStartFromQuery(false)}
                                    disabled={isLoading || querySelectedAsins.size === 0}
                                    className="text-slate-400 hover:text-slate-600 px-3 py-1.5 text-xs transition-all flex items-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                    <Zap className="w-3 h-3" /> Amazonカート価格のみ
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default ImportPage;
