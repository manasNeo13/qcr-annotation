import type { Permission } from '../utils/permissions';

export interface UploadResult {
  message: string;
  inserted: number;
  updated: number;
  skipped: number;
  /** Captures approved automatically (values = GRN on all fields). */
  autoApproved?: number;
  /** Capture day (IST, YYYY-MM-DD or 'unknown') → captures that got GRN data. */
  byDay?: { date: string; count: number }[];
}

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
  /** New scans only: best photos, each with the fields read from it (mrp | batch | mfd | exp). Empty = no photo. */
  images?: ScanImage[];
  /** New scan with no saved result yet → no values, not editable. */
  noResult?: boolean;
  /** Split team: who this capture is assigned to (name). null = shared (old capture). */
  assignedTo?: string | null;
  /** True when client GRN revalidation data was uploaded and any field was changed. */
  grnEdited?: boolean;
  /** GRN revalidation values from client-submitted Excel. Null when no GRN data uploaded. */
  /** session_results.metadata_status / grn_status (false once values change). */
  metadataStatus?: boolean;
  grnStatus?: boolean;
  grnData?: GrnData | null;
  /** New scans with a result: values our model read (before any edit). */
  modelData?: DocMetadata;
  /** Whole-capture approval (new scans). null = not approved yet. */
  approval?: Approval | null;
}

/** metadata = values as shown; grn = GRN values written into the capture. */
export type ApproveSource = 'metadata' | 'grn';

/** Per field: true = right, false = wrong, null = no value (not counted). */
export interface ApprovalMarks {
  mfgDate: boolean | null;
  expiryDate: boolean | null;
  batchNumber: boolean | null;
  mrp: boolean | null;
}

export interface Approval {
  /** What was approved: metadata (values shown), GRN, or auto (values matched GRN on all fields). */
  source: 'metadata' | 'grn' | 'auto';
  by: string | null;
  at: string | null;
  model: ApprovalMarks | null;
  /** null = no GRN data when approved. */
  grn: ApprovalMarks | null;
  /** Values changed after approval → approve again. */
  stale: boolean;
}

export interface ScanImage {
  url: string;
  fields: string[];
}

/** GRN revalidation data from client-submitted Excel. Dates are ISO YYYY-MM-DD or null. */
export interface GrnData {
  batch: string | null;
  mfd: string | null;
  exp: string | null;
  mrp: number | null;
  batchChanged: boolean;
  mfdChanged: boolean;
  expChanged: boolean;
  mrpChanged: boolean;
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
  /** Show only captures with GRN revalidation changes. */
  grnEdited?: boolean;
  /** Show only approved captures. */
  approved?: boolean;
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
  /** Images that day where that source changed the field. */
  bySource: Record<EditSource, FieldCounts>;
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
  /** New scans only (latest recapture); old captures → null/missing. */
  requestId?: string | null;
  assignedTo?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  latencyMs?: Partial<Record<LatencyKey, number>> | null;
}

export const LATENCY_KEYS = ['gate', 'patch', 'reader', 'vlm', 'total'] as const;
export type LatencyKey = (typeof LATENCY_KEYS)[number];

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
  /** Split team member: old captures of every client + captures assigned to them. */
  splitTeam?: boolean;
  /** NHQ / admin roles + split team: may upload GRN Excel. */
  grnUpload?: boolean;
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
  action:
    | 'user.create' | 'user.update' | 'user.delete' | 'user.password'
    | 'role.create' | 'role.update' | 'role.delete'
    | 'split.add' | 'split.remove' | 'split.move' | 'split.divide';
  target: { type: 'user' | 'role' | 'split'; id: string; name: string };
  changes: Record<string, { from: unknown; to: unknown }>;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Split team (NHQ) ─────────────────────────────────────────────────────
export interface SplitMember {
  id: string;
  name: string;
  email: string;
  active: boolean;
  joinedAt: string | null;
  /** Captures assigned today (IST) / in total. */
  today: number;
  total: number;
}
export interface SplitOverview {
  /** When dividing started (first member joined). null = no team yet. */
  startedAt: string | null;
  today: string;
  members: SplitMember[];
  candidates: { id: string; name: string; email: string }[];
  /** Sharing health on the backend copy that answered. */
  assigner?: SplitAssigner;
}
export interface SplitAssigner {
  /** Backend copy name (different names on refresh = several copies). */
  server: string;
  bootAt: string | null;
  running: boolean;
  lastRunAt: string | null;
  lastError: { at: string | null; message: string } | null;
  /** Active members this copy knows about. */
  members: number;
  /** Today on this copy: new captures found, shared out, kept shared (began before the team). */
  today: { found: number; assigned: number; keptShared: number };
}
export interface SplitDivideResult {
  captures: number;
  days: { day: string; captures: number }[];
  perMember: { id: string; captures: number }[];
  done: boolean;
}

// ── Accuracy page (Model / GRN vs approved values) ─────────────────────────
export type AccField = 'mrp' | 'mfgDate' | 'expiryDate' | 'batchNumber';
export type AccSource = 'model' | 'grn';
/** right / wrong = truth has a value; held = source has no value (NA); nv_* = truth blank (not on photo). */
export type AccResult = 'right' | 'wrong' | 'held' | 'nv_abstain' | 'nv_answered';
export type AccWinner = 'both' | 'model' | 'grn' | 'neither' | 'na';

export interface AccCounts {
  n: number;
  right: number;
  wrong: number;
  held: number;
  nv_abstain: number;
  nv_answered: number;
  day_conv: number;
  punct: number;
  answered: number;
  accuracy: number | null;
  coverage: number | null;
}
export type AccGroup = Partial<Record<AccField | 'ALL', Record<AccSource, AccCounts>>>;
export interface AccWins {
  both: number;
  model: number;
  grn: number;
  neither: number;
}
/** vals[src] = [value shown, result]. */
export type AccVals = Record<AccSource, [string, AccResult]>;
export interface AccMismatch {
  id: string;
  client: string;
  ean: string;
  field: AccField;
  edited: boolean;
  truth: string | null;
  by: string | null;
  vals: AccVals;
}
export interface AccRow {
  id: string;
  ean: string;
  client: string;
  by: string | null;
  at: string | null;
  fields: Record<AccField, { truth: string; edited: boolean; winner: AccWinner; model: AccResult; grn: AccResult; vals: AccVals }>;
}
export interface AccuracyReport {
  approved: number;
  /** Captures in range with a result (approvable). */
  total: number;
  /** Keys: ALL, EDITED, NOT_EDITED, client:<key>. */
  groups: Record<string, AccGroup>;
  order: string[];
  wins: Partial<Record<AccField | 'ALL', AccWins>>;
  mismatches: AccMismatch[];
  rows: AccRow[];
}
