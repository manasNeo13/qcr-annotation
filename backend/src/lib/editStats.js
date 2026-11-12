/**
 * Edit stats: how often annotators changed OCR values.
 * Input = repo DTOs (metadata, history, updatedBy, updatedAt, createdAt = capture time).
 * Changed = original OCR (history[0]) ≠ current, per field, after normalising.
 * Mirrors frontend utils/editStats.ts (mock mode).
 */
import { istDay } from './istDay.js';

const day = (v) => String(v ?? '').slice(0, 10);
const money = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 100) / 100);

export const FIELDS = [
  { key: 'batch', get: (m) => String(m.batchNumber ?? '').trim().toUpperCase() },
  { key: 'mrp', get: (m) => money(m.mrp) },
  { key: 'mfd', get: (m) => day(m.mfgDate) },
  { key: 'expiry', get: (m) => day(m.expiryDate) },
];

/** Editor name for edits made outside the dashboard (store app / SDK). */
export const SDK_EDITOR = 'SDK';
const sourceOf = (editor) => (editor === SDK_EDITOR ? 'sdk' : 'dashboard');

const zero = () => ({ batch: 0, mrp: 0, mfd: 0, expiry: 0, any: 0 });

/** Field keys that differ between two metadata snapshots. */
export function diffFields(a = {}, b = {}) {
  return FIELDS.filter((f) => f.get(a) !== f.get(b)).map((f) => f.key);
}

function add(counts, keys) {
  for (const k of keys) counts[k]++;
  if (keys.length) counts.any++;
}

/** Per-save transitions: [{ editor, at, fields }]. history[i] → history[i+1] → … → current. */
function saves(doc) {
  const h = doc.history ?? [];
  const states = [...h.map((x) => x.metadata), doc.metadata];
  return h.map((_, i) => ({
    editor: (i + 1 < h.length ? h[i + 1].editedBy : doc.updatedBy) || 'Unknown',
    at: i + 1 < h.length ? h[i + 1].editedAt : doc.updatedAt,
    fields: diffFields(states[i], states[i + 1]),
  }));
}

/** Per-editor changed fields across their saves (a later revert still counts). */
function fieldsByEditor(list) {
  const m = new Map();
  for (const s of list) {
    const cur = m.get(s.editor) ?? new Set();
    s.fields.forEach((f) => cur.add(f));
    m.set(s.editor, cur);
  }
  return m;
}

/**
 * Stats drill-down predicate. Same rules as computeEditStats so table counts = stat counts.
 * changed = field key | 'any'. editor set → that annotator changed it; else original ≠ current.
 * Returns null (no match) or { original, changed, editors }.
 */
export function editMatch(doc, { changed, editor }) {
  const hit = (keys) => (changed === 'any' ? keys.length > 0 : keys.includes(changed));
  const original = doc.history?.[0]?.metadata ?? doc.metadata;
  const fields = diffFields(original, doc.metadata);
  const byEditor = fieldsByEditor(saves(doc));
  const ok = editor ? hit([...(byEditor.get(editor) ?? [])]) : hit(fields);
  return ok ? { original, changed: fields, editors: [...byEditor.keys()] } : null;
}

/** Filter + count + sort (last edit, newest first) + paginate. docs = DTOs in capture range. */
export function editedPage(docs, { changed, editor, status = 'all', page = 1, pageSize = Infinity }) {
  const matched = [];
  for (const d of docs) {
    const edit = editMatch(d, { changed, editor });
    if (edit) matched.push({ ...d, edit });
  }
  const counts = { all: matched.length, ok: 0, near_expiry: 0, expired: 0 };
  for (const d of matched) counts[d.status]++;
  const rows = (status === 'all' ? matched : matched.filter((d) => d.status === status)).sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id),
  );
  const items = Number.isFinite(pageSize) ? rows.slice((page - 1) * pageSize, page * pageSize) : rows;
  return { items, total: rows.length, counts };
}

/**
 * docs → { total, changed, bySource, byDay, annotators, rows? }.
 * bySource.{dashboard,sdk}[field] = images where that source changed the field (any save; revert still counts).
 * annotators[].changed = images where THEY changed a field (a later revert still counts).
 */
export function computeEditStats(docs, { detail = false } = {}) {
  const changed = zero();
  const bySource = { dashboard: zero(), sdk: zero() };
  const days = new Map();
  const people = new Map();
  const rows = [];

  for (const d of docs) {
    const original = d.history?.[0]?.metadata ?? d.metadata;
    const fields = diffFields(original, d.metadata);
    const date = istDay(new Date(d.createdAt));
    add(changed, fields);

    const dd = days.get(date) ?? { date, total: 0, changed: zero() };
    dd.total++;
    add(dd.changed, fields);
    days.set(date, dd);

    const list = saves(d);
    const byEditor = new Map();
    for (const s of list) {
      const cur = byEditor.get(s.editor) ?? { saves: 0, fields: new Set() };
      cur.saves++;
      s.fields.forEach((f) => cur.fields.add(f));
      byEditor.set(s.editor, cur);
    }
    const src = { dashboard: new Set(), sdk: new Set() };
    for (const [name, v] of byEditor) v.fields.forEach((f) => src[sourceOf(name)].add(f));
    add(bySource.dashboard, [...src.dashboard]);
    add(bySource.sdk, [...src.sdk]);

    for (const [name, v] of byEditor) {
      const p = people.get(name) ?? { name, images: 0, saves: 0, changed: zero() };
      p.images++;
      p.saves += v.saves;
      add(p.changed, [...v.fields]);
      people.set(name, p);
    }

    if (detail) {
      rows.push({
        id: d.id,
        captureDay: date,
        ean: d.ean ?? '',
        original,
        final: d.metadata,
        changed: fields,
        editors: [...byEditor.keys()],
        saves: list.length,
        lastEditedAt: list.length ? d.updatedAt : null,
      });
    }
  }

  return {
    total: docs.length,
    changed,
    bySource,
    byDay: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    annotators: [...people.values()].sort((a, b) => b.images - a.images || a.name.localeCompare(b.name)),
    ...(detail ? { rows: rows.sort((a, b) => a.captureDay.localeCompare(b.captureDay) || a.id.localeCompare(b.id)) } : {}),
  };
}
