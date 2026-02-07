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
