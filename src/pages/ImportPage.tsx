import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Papa from 'papaparse';
import { Upload, FileText, AlertCircle, Play, Loader2, Info } from 'lucide-react';
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

    const processFile = (uploadedFile: File) => {
        setFile(uploadedFile);
        setError(null);
        setDetectedAsinColumn(null);
        setDetectedPriceColumn(null);
        setOriginalCsvData(null);

        Papa.parse(uploadedFile, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (header) => header.trim(),
            complete: (results) => {
                const rows = results.data as Record<string, string>[];
                const headers = results.meta.fields || [];

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

                    if (bestColumn && bestCount > rows.length * 0.3) {
                        asinColumnKey = bestColumn;
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

    const handleStart = async () => {
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
            navigate(`/results/${res.data.runId}`);
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: string } } };
            setError(error.response?.data?.error || 'サーバーでの処理開始に失敗しました。');
            setIsLoading(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto space-y-8">
            <div className="text-center space-y-2">
                <h2 className="text-3xl font-bold text-slate-800">ASINインポート</h2>
                <p className="text-slate-500">
                    ASIN列を含むCSVファイルをアップロードして、Amazon価格をチェックします。
                </p>
            </div>

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

            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg flex items-center gap-3">
                    <AlertCircle className="w-5 h-5" />
                    <p>{error}</p>
                </div>
            )}

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

                        <div className="mt-6 flex justify-end">
                            <button
                                onClick={handleStart}
                                disabled={isLoading || stats.unique === 0}
                                className="bg-amazon-orange hover:bg-yellow-500 text-white px-8 py-3 rounded-lg font-bold shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" /> 処理開始中...
                                    </>
                                ) : (
                                    <>
                                        価格チェック開始 <Play className="w-5 h-5 fill-current" />
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ImportPage;
