/** In-memory repo (DATA_SOURCE=memory). Dev only — resets on restart. No store scoping. */
import { labelImage, seedDocuments, seedUsers } from '../dev/seed.js';
import { computeEditStats, editedPage } from '../lib/editStats.js';
import { istDay } from '../lib/istDay.js';
import { getStatus } from '../lib/status.js';
import { NONE_KEY } from '../lib/validation.js';

const users = seedUsers();
const docs = seedDocuments();

const statusOf = (d) => getStatus(d.metadata.mfgDate, d.metadata.expiryDate);
const toDto = (d) => ({ ...d, imageRef: labelImage(d), status: statusOf(d), history: [...d.history] });
/** Mock EAN = product name (memory mode has no real EANs). */
const eanOf = (d) => d.productName;
const keyMatch = (v, want) => !want || (want === NONE_KEY ? !v : v === want);

/** Capture day (createdAt, IST) in [from, to] + search — edit stats scope. */
function capturedIn({ q = '', from, to }) {
  const term = q.toLowerCase();
  return docs.filter((d) => {
    const day = istDay(new Date(d.createdAt));
    if (from && (day < from || day > to)) return false;
    return !term || [d.productName, d.fileName, d.metadata.batchNumber, d.id].some((f) => f.toLowerCase().includes(term));
  });
}

function filterDocs({ q = '', from, to, ean, batch }) {
  const term = q.toLowerCase();
  return docs.filter((d) => {
    const day = istDay(new Date(d.updatedAt));
    if (from && (day < from || day > to)) return false;
    if (term && ![d.productName, d.fileName, d.metadata.batchNumber, d.id].some((f) => f.toLowerCase().includes(term))) return false;
    return keyMatch(eanOf(d), ean) && keyMatch(d.metadata.batchNumber, batch);
  });
}

export const memoryRepo = {
  name: 'memory',
  async init() {
    console.log(`[repo] memory — ${docs.length} docs, demo login: ${users[0].email} / demo`);
  },
  async close() {},

  /** Live captures: demo data never grows → no events. */
  live: {
    async since() {
      return [];
    },
    async byIds() {
      return [];
    },
    async storesOf() {
      return new Map();
    },
    async visibleTo(_user, events) {
      return events;
    },
    onAnnounced() {},
    async prints() {
      return [];
    },
    async count() {
      return docs.length;
    },
  },

  users: {
    async findForLogin(email) {
      const u = users.find((x) => x.email.toLowerCase() === email.toLowerCase());
      return u ? { ...u, role: 'NHQ', active: true, mustChangePassword: false } : null;
    },
    async passwordHashOf(userId) {
      return users.find((x) => x.id === userId)?.passwordHash ?? null;
    },
    async setOwnPassword(userId, hash) {
      const u = users.find((x) => x.id === userId);
      if (u) u.passwordHash = hash;
    },
  },

  documents: {
    async list({ page, pageSize, status, ...f }) {
      const searched = filterDocs(f);
      const counts = { all: searched.length, ok: 0, near_expiry: 0, expired: 0 };
      for (const d of searched) counts[statusOf(d)]++;
      const byStatus = status === 'all' ? searched : searched.filter((d) => statusOf(d) === status);
      const sorted = [...byStatus].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const start = (page - 1) * pageSize;
      return { items: sorted.slice(start, start + pageSize).map(toDto), total: byStatus.length, counts };
    },

    async dayCounts({ from, to }) {
      const map = new Map();
      let latest = null;
      for (const d of docs) {
        const day = istDay(new Date(d.updatedAt));
        if (!latest || day > latest) latest = day;
        if (day >= from && day <= to) map.set(day, (map.get(day) ?? 0) + 1);
      }
      return { days: [...map].sort().map(([date, count]) => ({ date, count })), latest };
    },

    async orderedIds(f) {
      const { items } = await this.list({ ...f, page: 1, pageSize: docs.length });
      return items.map((d) => d.id);
    },

    async filterOptions() {
      return { clients: [] };
    },

    async groups(by, { page, pageSize, status, ...f }) {
      const rows = filterDocs(f);
      const counts = { all: rows.length, ok: 0, near_expiry: 0, expired: 0 };
      for (const d of rows) counts[statusOf(d)]++;
      const map = new Map();
      for (const d of rows) {
        const st = statusOf(d);
        if (status !== 'all' && st !== status) continue;
        const key = (by === 'ean' ? eanOf(d) : d.metadata.batchNumber) || NONE_KEY;
        const g = map.get(key) ?? { key, total: 0, batchSet: new Set(), counts: { ok: 0, near_expiry: 0, expired: 0 }, latest: '' };
        g.total++;
        g.counts[st]++;
        g.batchSet.add(d.metadata.batchNumber || NONE_KEY);
        if (d.updatedAt > g.latest) g.latest = d.updatedAt;
        map.set(key, g);
      }
      const all = [...map.values()].sort((a, b) =>
        by === 'ean'
          ? b.batchSet.size - a.batchSet.size || b.total - a.total || b.latest.localeCompare(a.latest)
          : b.latest.localeCompare(a.latest),
      );
      const start = (page - 1) * pageSize;
      return {
        total: all.length,
        counts,
        items: all.slice(start, start + pageSize).map(({ batchSet, ...g }) => ({ ...g, ...(by === 'ean' ? { batches: batchSet.size } : {}) })),
      };
    },

    /** Capture day = createdAt (IST). */
    async editStats({ from, to, detail }) {
      return computeEditStats(capturedIn({ from, to }).map(toDto), { detail });
    },

    /** Stats drill-down list (see lib/editStats editedPage). */
    async edited(f) {
      return editedPage(capturedIn(f).map(toDto), f);
    },

    async editedIds(f) {
      return editedPage(capturedIn(f).map(toDto), { ...f, pageSize: Infinity }).items.map((d) => d.id);
    },

    async get(id) {
      const d = docs.find((x) => x.id === id);
      return d ? toDto(d) : null;
    },

    async update(id, metadata, user) {
      const d = docs.find((x) => x.id === id);
      if (!d) return null;
      d.history.push({ version: d.version, metadata: d.metadata, editedBy: d.updatedBy ?? 'system', editedAt: d.updatedAt });
      d.metadata = metadata;
      d.version += 1;
      d.updatedAt = new Date().toISOString();
      d.updatedBy = user.name || user.email;
      return toDto(d);
    },
  },

  clientMetadata: {
    async upsertMany(records) {
      // In-memory stub — not persisted across restarts
      return { inserted: records.length, updated: 0 };
    },
  },
};
