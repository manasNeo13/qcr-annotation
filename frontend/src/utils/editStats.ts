/**
 * Edit stats helpers. computeEditStats mirrors backend lib/editStats.js (mock mode only).
 * Changed = original OCR (history[0]) ≠ current, per field, after normalising.
 */
import type {
  AnnotatorStats,
  DayStats,
  DocMetadata,
  DocumentItem,
  EditField,
  EditStats,
  FieldCounts,
  StatsRow,
} from '../types';

/** Display order: Batch, MRP, MFD, Expiry (EAN comes first where shown, not editable). */
export const FIELD_LABELS: Record<EditField, string> = { batch: 'Batch', mrp: 'MRP', mfd: 'MFD', expiry: 'Expiry' };
export const EDIT_FIELDS = Object.keys(FIELD_LABELS) as EditField[];

const day = (v: unknown) => String(v ?? '').slice(0, 10);
const money = (v: unknown) =>
  v == null || v === '' || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 100) / 100;

const GET: Record<EditField, (m: Partial<DocMetadata>) => string | number | null> = {
  expiry: (m) => day(m.expiryDate),
  batch: (m) => String(m.batchNumber ?? '').trim().toUpperCase(),
  mrp: (m) => money(m.mrp),
  mfd: (m) => day(m.mfgDate),
};

const zero = (): FieldCounts => ({ batch: 0, mrp: 0, mfd: 0, expiry: 0, any: 0 });
const diff = (a: Partial<DocMetadata> = {}, b: Partial<DocMetadata> = {}) =>
  EDIT_FIELDS.filter((k) => GET[k](a) !== GET[k](b));
const add = (c: FieldCounts, keys: EditField[]) => {
  keys.forEach((k) => c[k]++);
  if (keys.length) c.any++;
};

/** % with 2 decimals, '0.00%' when no images. */
export const pct = (n: number, total: number) => `${total ? ((n / total) * 100).toFixed(2) : '0.00'}%`;

export function computeEditStats(
  docs: DocumentItem[],
  { detail = false, dayOf }: { detail?: boolean; dayOf: (iso: string) => string },
): EditStats {
  const changed = zero();
  const days = new Map<string, DayStats>();
  const people = new Map<string, AnnotatorStats>();
  const rows: StatsRow[] = [];

  for (const d of docs) {
    const original = d.history[0]?.metadata ?? d.metadata;
    const fields = diff(original, d.metadata);
    const date = dayOf(d.createdAt);
    add(changed, fields);
    const dd = days.get(date) ?? { date, total: 0, changed: zero() };
    dd.total++;
    add(dd.changed, fields);
    days.set(date, dd);

    const h = d.history;
    const states = [...h.map((x) => x.metadata), d.metadata];
    const byEditor = new Map<string, { saves: number; fields: Set<EditField> }>();
    h.forEach((_, i) => {
      const editor = (i + 1 < h.length ? h[i + 1].editedBy : d.updatedBy) || 'Unknown';
      const cur = byEditor.get(editor) ?? { saves: 0, fields: new Set<EditField>() };
      cur.saves++;
      diff(states[i], states[i + 1]).forEach((f) => cur.fields.add(f));
      byEditor.set(editor, cur);
    });
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
        saves: h.length,
        lastEditedAt: h.length ? d.updatedAt : null,
      });
    }
  }

  return {
    total: docs.length,
    changed,
    byDay: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    annotators: [...people.values()].sort((a, b) => b.images - a.images || a.name.localeCompare(b.name)),
    ...(detail ? { rows: rows.sort((a, b) => a.captureDay.localeCompare(b.captureDay) || a.id.localeCompare(b.id)) } : {}),
  };
}

// ── CSV ──────────────────────────────────────────────────────────────────
export type Cell = string | number | null | undefined;
const esc = (v: Cell) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (lines: Cell[][]) => lines.map((l) => l.map(esc).join(',')).join('\r\n');

/** Browser download. BOM so Excel reads UTF-8 (₹, names). */
export function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const countCols = (c: FieldCounts, total: number) =>
  [...EDIT_FIELDS, 'any' as const].flatMap((k) => [c[k], pct(c[k], total)]);
const countHead = [...EDIT_FIELDS.map((k) => FIELD_LABELS[k]), 'Any change'].flatMap((l) => [l, `${l} %`]);

export const summaryLines = (s: EditStats): Cell[][] => [
  ['Field', 'Images changed', '% of images'],
  ['Total images', s.total, ''],
  ...EDIT_FIELDS.map((k) => [FIELD_LABELS[k], s.changed[k], pct(s.changed[k], s.total)]),
  ['Any change', s.changed.any, pct(s.changed.any, s.total)],
];

export const dayLines = (s: EditStats): Cell[][] => [
  ['Capture day', 'Total images', ...countHead],
  ...s.byDay.map((d) => [d.date, d.total, ...countCols(d.changed, d.total)]),
];

export const annotatorLines = (list: AnnotatorStats[]): Cell[][] => [
  ['Annotator', 'Images handled', ...countHead],
  ...list.map((a) => [a.name, a.images, ...countCols(a.changed, a.images)]),
];

export const detailLines = (rows: StatsRow[]): Cell[][] => [
  [
    'Capture ID', 'Capture day', 'EAN',
    'Original batch', 'Final batch', 'Original MRP', 'Final MRP',
    'Original MFD', 'Final MFD', 'Original expiry', 'Final expiry',
    'Fields changed', 'Any change', 'Annotators', 'Last edited at',
  ],
  ...rows.map((r) => [
    r.id, r.captureDay, r.ean,
    r.original.batchNumber, r.final.batchNumber, r.original.mrp, r.final.mrp,
    r.original.mfgDate, r.final.mfgDate, r.original.expiryDate, r.final.expiryDate,
    r.changed.map((k) => FIELD_LABELS[k]).join(' | '), r.changed.length ? 'Yes' : 'No',
    r.editors.join(' | '), r.lastEditedAt ?? '',
  ]),
];
