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
        try {
            const res = await axios.post('/api/keepa-query', { queryUrl: queryUrl.trim() });
            setQueryResults(res.data.asinList);
            setQueryTotalResults(res.data.totalResults);
            setQuerySelection(res.data.selection);
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: string } } };
            setQueryError(error.response?.data?.error || 'クエリ実行に失敗しました');
        }
        setQueryExecuting(false);
    };

    const handleStartFromQuery = async (autoCompare: boolean = false) => {
        if (queryResults.length === 0) return;
        setIsLoading(true);
        try {
            const res = await axios.post('/api/runs', { asins: queryResults });
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
                <h2 className="text-3xl font-bold text-slate-800">ASIN登録</h2>
                <p className="text-slate-500">Amazon商品のASINを登録して価格チェック・楽天比較を行います。</p>
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

                                <div className="mt-6 flex justify-end gap-3">
                                    <button
                                        onClick={() => handleStart(true)}
                                        disabled={isLoading || stats.unique === 0}
                                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-lg font-bold shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isLoading ? (
                                            <>
                                                <Loader2 className="w-5 h-5 animate-spin" /> 処理開始中...
                                            </>
                                        ) : (
                                            <>
                                                <GitCompareArrows className="w-5 h-5" /> 楽天比較開始
                                            </>
                                        )}
                                    </button>
                                    <button
                                        onClick={() => handleStart(false)}
                                        disabled={isLoading || stats.unique === 0}
                                        className="bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 px-5 py-2.5 rounded-lg font-medium text-sm shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Zap className="w-4 h-4" /> カート価格のみ（高速）
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

                                <div className="mt-6 flex justify-end gap-3">
                                    <button onClick={() => handleStartFromText(true)} disabled={isLoading || textAsins.length === 0}
                                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-lg font-bold shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                                        {isLoading ? <><Loader2 className="w-5 h-5 animate-spin" /> 処理開始中...</> : <><GitCompareArrows className="w-5 h-5" /> 楽天比較開始</>}
                                    </button>
                                    <button onClick={() => handleStartFromText(false)} disabled={isLoading || textAsins.length === 0}
                                        className="bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 px-5 py-2.5 rounded-lg font-medium text-sm shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                                        <Zap className="w-4 h-4" /> カート価格のみ（高速）
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

                            <div className="p-4 border-t border-slate-200 flex justify-end gap-3">
                                <button onClick={() => handleStartFromKeepa(true)} disabled={isLoading || keepaResults.filter(r => r.selected).length === 0}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-lg font-bold shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                                    {isLoading ? <><Loader2 className="w-5 h-5 animate-spin" /> 処理開始中...</> : <><GitCompareArrows className="w-5 h-5" /> 選択した{keepaResults.filter(r => r.selected).length}件で楽天比較開始</>}
                                </button>
                                <button onClick={() => handleStartFromKeepa(false)} disabled={isLoading || keepaResults.filter(r => r.selected).length === 0}
                                    className="bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 px-5 py-2.5 rounded-lg font-medium text-sm shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                                    <Zap className="w-4 h-4" /> カート価格のみ（高速）
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

                    {/* 結果表示 */}
                    {queryResults.length > 0 && (
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                            <div className="px-6 py-4 bg-green-50 border-b border-green-100">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-bold text-green-800">
                                        取得結果: {queryTotalResults.toLocaleString()}件のASIN
                                    </span>
                                </div>
                            </div>

                            <div className="p-6 bg-slate-50">
                                {/* プレビュー: 最初の10件 */}
                                <h4 className="text-sm font-semibold text-slate-600 mb-3 flex items-center gap-2">
                                    <FileText className="w-4 h-4" /> プレビュー（最初の10件）
                                </h4>
                                <div className="bg-white border rounded-md overflow-hidden mb-4">
                                    <div className="grid grid-cols-5 gap-2 p-3">
                                        {queryResults.slice(0, 10).map((asin, i) => (
                                            <div key={i} className="font-mono text-xs text-slate-700 bg-slate-50 px-2 py-1 rounded text-center">
                                                {asin}
                                            </div>
                                        ))}
                                    </div>
                                    {queryResults.length > 10 && (
                                        <div className="px-3 pb-3 text-xs text-slate-400 text-center">
                                            ... 他 {(queryResults.length - 10).toLocaleString()} 件
                                        </div>
                                    )}
                                </div>

                                {/* 開始ボタン */}
                                <div className="flex justify-end gap-3">
                                    <button
                                        onClick={() => handleStartFromQuery(true)}
                                        disabled={isLoading}
                                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-lg font-bold shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isLoading ? (
                                            <><Loader2 className="w-5 h-5 animate-spin" /> 処理開始中...</>
                                        ) : (
                                            <><GitCompareArrows className="w-5 h-5" /> {queryResults.length.toLocaleString()}件で楽天比較開始</>
                                        )}
                                    </button>
                                    <button
                                        onClick={() => handleStartFromQuery(false)}
                                        disabled={isLoading}
                                        className="bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 px-5 py-2.5 rounded-lg font-medium text-sm shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Zap className="w-4 h-4" /> カート価格のみ（高速）
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default ImportPage;
