import type { Permission } from '../utils/permissions';

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
  /** Captures without a client exist (super admin only). */
  noClient?: boolean;
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
  /** Signed in with a temporary password → must set own before anything else. */
  mustChangePassword?: boolean;
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

export type EditSource = 'dashboard' | 'sdk';

export interface EditStats {
  total: number;
  /** Images where final ≠ OCR (any source). */
  changed: FieldCounts;
  /** Images where that source changed the field (a later revert still counts). */
  bySource: Record<EditSource, FieldCounts>;
  byDay: DayStats[];
  annotators: AnnotatorStats[];
  rows?: StatsRow[];
}

// ── Access + user management ─────────────────────────────────────────────
/** GET /auth/me: current user + role + permissions (fresh from DB). */
export interface Me extends User {
  role: string;
  roleKey: string;
  permissions: Permission[];
  /** NHQ: sees every client + manages users. */
  superAdmin: boolean;
  /** Assigned clients (others see only these). */
  clients: string[];
  mustChangePassword?: boolean;
}

export interface AdminUser {
  key: string; // address for PATCH (id, or _id for legacy doc)
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string; // stored spelling; '' = No role
  roleKey: string;
  active: boolean;
  stores: string[];
  clients: string[];
  hasPassword: boolean;
  /** Temporary password not yet replaced by the user. */
  mustChangePassword: boolean;
  createdAt: string | null;
}

export interface AdminUserInput {
  name: string;
  email: string;
  phone: string;
  role: string;
  active: boolean;
  stores: string[];
  clients: string[];
}

export interface StoreOption {
  id: string;
  name: string;
  city: string;
  kind: 'store' | 'warehouse';
}

export interface RoleInfo {
  key: string; // '' = No role
  name: string;
  variants: string[]; // spellings merged into this role
  permissions: Permission[];
  users: number;
  locked: boolean;
  custom: boolean;
  deletable: boolean;
}

export interface AuditEntry {
  id: string;
  at: string | null;
  by: { id: string; name: string };
  action: 'user.create' | 'user.update' | 'user.delete' | 'user.password' | 'role.create' | 'role.update' | 'role.delete';
  target: { type: 'user' | 'role'; id: string; name: string };
  changes: Record<string, { from: unknown; to: unknown }>;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
