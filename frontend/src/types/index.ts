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
  ean?: string;
  /** Previous versions, oldest first. history[0] = original values. */
  history: HistoryEntry[];
  /** Only on /documents/edited rows. */
  edit?: EditInfo;
}

/** Edit drill-down row info: original OCR values, fields changed (original ≠ final), who saved. */
export interface EditInfo {
  original: DocMetadata;
  changed: EditField[];
  editors: string[];
}

export interface ListParams {
  page: number; // 1-based
  pageSize: number;
  q?: string;
  status?: StatusFilter;
  /** IST capture day range, YYYY-MM-DD inclusive. Omitted = all dates. */
  from?: string;
  to?: string;
  /** Scope: client_name. */
  client?: string;
  /** Drill-down. NONE_KEY = missing value. */
  ean?: string;
  batch?: string;
  /** Edit-stats drill-down: field changed ('any' = any field), optionally by this annotator. */
  changed?: EditKey;
  editor?: string;
}

export type ListFilter = Omit<ListParams, 'page' | 'pageSize'>;

/** Sentinel for "No EAN" / "No batch" groups (same as backend). */
export const NONE_KEY = '__none__';

export interface GroupItem {
  key: string; // EAN or batch; NONE_KEY = missing
  total: number;
  batches?: number; // EAN groups only
  counts: Record<DocStatus, number>;
  latest: string | null;
}

export interface GroupResponse {
  items: GroupItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<StatusFilter, number>;
}

export interface FilterOptions {
  clients: string[];
}

/** Scope filters that also narrow calendar dots. */
export type DayScope = Pick<ListParams, 'client'>;

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

/** Edit stats fields (OCR value changed by an annotator). */
export type EditField = 'batch' | 'mrp' | 'mfd' | 'expiry';
export type EditKey = EditField | 'any';
export type FieldCounts = Record<EditKey, number>;

export interface StatsFilter {
  /** IST capture day range. Omitted = all dates. */
  from?: string;
  to?: string;
  client?: string;
}

export interface DayStats {
  date: string;
  total: number;
  changed: FieldCounts;
}

export interface AnnotatorStats {
  name: string;
  /** Images handled = saved at least once by this annotator. */
  images: number;
  saves: number;
  /** Images where THEY changed the field. */
  changed: FieldCounts;
}

/** Per-image row (CSV detail). */
export interface StatsRow {
  id: string;
  captureDay: string;
  ean: string;
  original: DocMetadata;
  final: DocMetadata;
  changed: EditField[];
  editors: string[];
  saves: number;
  lastEditedAt: string | null;
}

export interface EditStats {
  total: number;
  changed: FieldCounts;
  byDay: DayStats[];
  annotators: AnnotatorStats[];
  rows?: StatsRow[];
}
