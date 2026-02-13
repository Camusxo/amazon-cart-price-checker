export enum ItemStatus {
  PENDING = 'PENDING',
  OK = 'OK',
  NO_OFFER = 'NO_OFFER',
  NOT_FOUND = 'NOT_FOUND',
  THROTTLED = 'THROTTLED',
  AUTH_ERROR = 'AUTH_ERROR',
  ERROR = 'ERROR'
}

export interface ProductResult {
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

export interface RunStats {
  total: number;
  processed: number;
  success: number;
  failed: number;
  startTime: number;
  endTime?: number;
}

export interface RunSession {
  id: string;
  createdAt: number;
  items: ProductResult[];
  logs: string[];
  isRunning: boolean;
  stats: RunStats;
}

export interface RunSummary {
  id: string;
  createdAt: number;
  total: number;
  processed: number;
}

export interface CreateRunResponse {
  runId: string;
}

export interface OriginalRowData {
  rowIndex: number;
  originalRow: Record<string, string>;
  asin: string;
}

export interface OriginalCsvData {
  headers: string[];
  asinColumn: string;
  priceColumn: string | null;
  rows: OriginalRowData[];
}

// --- 楽天比較関連 ---

export type ComparisonStatus = 'MATCHED' | 'NO_MATCH' | 'PENDING' | 'ERROR';

export interface RakutenProduct {
  itemName: string;
  itemPrice: number;
  itemUrl: string;
  shopName: string;
  shopUrl: string;
  imageUrl: string;
  pointRate: number;
  genreId: string;
}

export interface ComparisonItem {
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

export interface ComparisonStats {
  total: number;
  processed: number;
  matched: number;
  profitable: number;
}

export interface ComparisonSession {
  id: string;
  runId: string;
  createdAt: number;
  items: ComparisonItem[];
  isRunning: boolean;
  stats: ComparisonStats;
}

export interface ComparisonSummary {
  id: string;
  runId: string;
  createdAt: number;
  total: number;
  matched: number;
  profitable: number;
}
