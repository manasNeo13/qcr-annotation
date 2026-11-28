/**
 * Accuracy page: Model and GRN values vs the approved values (ground truth).
 * Same rules as the colleague's Flask GT tool (/accuracy):
 *   right / wrong when the truth has a value and the source has one,
 *   held (NA, not counted) when the source has no value,
 *   nv_answered / nv_abstain when the truth is blank (not on the photo).
 *   accuracy = right ÷ (right + wrong), coverage = (right + wrong) ÷ fields with truth.
 * Values are DTO metadata { mfgDate, expiryDate, batchNumber (text), mrp (number|null) } (dates ISO "YYYY-MM-DD").
 */

export const ACC_FIELDS = ['mrp', 'mfgDate', 'expiryDate', 'batchNumber'];
export const ACC_SOURCES = ['model', 'grn'];
const GRN_CHANGED = { mrp: 'mrpChanged', mfgDate: 'mfdChanged', expiryDate: 'expChanged', batchNumber: 'batchChanged' };

const blank = (v) => v == null || String(v).trim() === '';
const normBatch = (v, loose = false) => {
  const s = String(v).replace(/\s+/g, '').toUpperCase();
  return loose ? s.replace(/[^A-Z0-9]/g, '') : s;
};
const parseDay = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
};
/** 1st or last day of its month. */
const edgeDay = (d) => d.getUTCDate() === 1 || new Date(d.getTime() + 86_400_000).getUTCDate() === 1;

/** → [same?, near-miss note ('' | 'day_conv' | 'punct')] */
function compare(field, truth, pred) {
  if (field === 'mrp') {
    const a = Number(String(truth).replace(/[^\d.]/g, ''));
    const b = Number(String(pred).replace(/[^\d.]/g, ''));
    if (Number.isNaN(a) || Number.isNaN(b)) return [String(truth).trim() === String(pred).trim(), ''];
    return [Math.abs(a - b) < 0.01, ''];
  }
  if (field === 'mfgDate' || field === 'expiryDate') {
    const t = parseDay(truth);
    const p = parseDay(pred);
    if (!t || !p) return [String(truth).trim() === String(pred).trim(), ''];
    if (t.getTime() === p.getTime()) return [true, ''];
    const sameMonth = t.getUTCFullYear() === p.getUTCFullYear() && t.getUTCMonth() === p.getUTCMonth();
    return [false, sameMonth && edgeDay(t) && edgeDay(p) ? 'day_conv' : ''];
  }
  if (normBatch(truth) === normBatch(pred)) return [true, ''];
  return [false, normBatch(truth, true) === normBatch(pred, true) ? 'punct' : ''];
}

/** → [right | wrong | held | nv_abstain | nv_answered, note] */
function score(field, visible, truth, pred) {
  if (!visible) return [blank(pred) ? 'nv_abstain' : 'nv_answered', ''];
  if (blank(pred)) return ['held', ''];
  const [ok, note] = compare(field, truth, pred);
  return [ok ? 'right' : 'wrong', note];
}

const counts = () => ({ n: 0, right: 0, wrong: 0, held: 0, nv_abstain: 0, nv_answered: 0, day_conv: 0, punct: 0 });

/**
 * items: [{ id, ean, client, at, by, truth, model, grn (or null), changed (GRN changed flags or null) }]
 * total: all captures in range (with a result) → "N of M approved".
 */
export function computeAccuracy(items, { total = items.length } = {}) {
  const groups = {};
  const wins = {};
  const mismatches = [];
  const rows = [];
  for (const it of items) {
    const row = { id: it.id, ean: it.ean, client: it.client, by: it.by, at: it.at, fields: {} };
    for (const fl of ACC_FIELDS) {
      const truth = it.truth?.[fl];
      const visible = !blank(truth);
      const edited = !!(it.changed && it.changed[GRN_CHANGED[fl]]);
      const keys = ['ALL', edited ? 'EDITED' : 'NOT_EDITED', `client:${it.client || ''}`];
      const res = {};
      const vals = {};
      for (const src of ACC_SOURCES) {
        const pred = it[src]?.[fl];
        const [out, note] = score(fl, visible, truth, pred);
        res[src] = out;
        vals[src] = [blank(pred) ? '' : String(pred), out];
        for (const gk of keys) {
          for (const fk of [fl, 'ALL']) {
            const G = (groups[gk] ??= {});
            const F = (G[fk] ??= {});
            const c = (F[src] ??= counts());
            c[out] += 1;
            c.n += visible ? 1 : 0;
            if (note) c[note] += 1;
          }
        }
      }
      let winner = 'na';
      if (visible) {
        const m = res.model === 'right';
        const g = res.grn === 'right';
        winner = m && g ? 'both' : m ? 'model' : g ? 'grn' : 'neither';
        for (const fk of [fl, 'ALL']) (wins[fk] ??= { both: 0, model: 0, grn: 0, neither: 0 })[winner] += 1;
      }
      row.fields[fl] = { truth: visible ? String(truth) : '', edited, winner, model: res.model, grn: res.grn, vals };
      if (Object.values(res).some((v) => v === 'wrong' || v === 'nv_answered')) {
        mismatches.push({ id: it.id, client: it.client, ean: it.ean, field: fl, edited, truth: visible ? String(truth) : null, by: it.by, vals });
      }
    }
    rows.push(row);
  }
  for (const G of Object.values(groups)) {
    for (const F of Object.values(G)) {
      for (const c of Object.values(F)) {
        const ans = c.right + c.wrong;
        c.answered = ans;
        c.accuracy = ans ? Math.round((1000 * c.right) / ans) / 10 : null;
        c.coverage = c.n ? Math.round((1000 * ans) / c.n) / 10 : null;
      }
    }
  }
  const clients = Object.keys(groups).filter((k) => k.startsWith('client:')).sort();
  const order = [...['ALL', 'EDITED', 'NOT_EDITED'].filter((k) => groups[k]), ...clients];
  return { approved: items.length, total, groups, order, wins, mismatches, rows };
}
