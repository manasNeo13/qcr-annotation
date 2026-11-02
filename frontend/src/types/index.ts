export type DocStatus = 'ok' | 'near_expiry' | 'expired';
export type StatusFilter = DocStatus | 'all';

/** Editable fields. Dates are ISO `YYYY-MM-DD`. */
export interface DocMetadata {
  mfgDate: string;
  expiryDate: string;
  batchNumber: string;
  mrp: number | null; // null = not read by OCR
}

export interface HistoryEntry {
  version: number;
  metadata: DocMetadata;
  editedBy: string;
  editedAt: string;
}

export interface DocumentItem {
  id: string;
  productName: string;
  fileName: string;
  imageUrl: string;
  metadata: DocMetadata;
  status: DocStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
  /** Previous versions, oldest first. history[0] = original values. */
  history: HistoryEntry[];
}

export interface ListParams {
  page: number; // 1-based
  pageSize: number;
  q?: string;
  status?: StatusFilter;
  /** IST capture day range, YYYY-MM-DD inclusive. Omitted = all dates. */
  from?: string;
  to?: string;
}

export type ListFilter = Pick<ListParams, 'q' | 'status' | 'from' | 'to'>;

export interface DayCounts {
  days: { date: string; count: number }[];
  /** Latest day with any capture (default selection). */
  latest: string | null;
}

export interface ListResponse {
  items: DocumentItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<StatusFilter, number>;
}

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface Neighbors {
  prevId: string | null;
  nextId: string | null;
  /** 0-based position in current filter; -1 = not in it. */
  index: number;
  total: number;
}
