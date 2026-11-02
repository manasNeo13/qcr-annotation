/** In-memory repo (DATA_SOURCE=memory). Dev only — resets on restart. No store scoping. */
import { labelImage, seedDocuments, seedUsers } from '../dev/seed.js';
import { istDay } from '../lib/istDay.js';
import { getStatus } from '../lib/status.js';

const users = seedUsers();
const docs = seedDocuments();

const statusOf = (d) => getStatus(d.metadata.mfgDate, d.metadata.expiryDate);
const toDto = (d) => ({ ...d, imageRef: labelImage(d), status: statusOf(d), history: [...d.history] });

export const memoryRepo = {
  name: 'memory',
  async init() {
    console.log(`[repo] memory — ${docs.length} docs, demo login: ${users[0].email} / demo`);
  },
  async close() {},

  users: {
    async findForLogin(email) {
      const u = users.find((x) => x.email.toLowerCase() === email.toLowerCase());
      return u ? { ...u, role: 'NHQ', active: true } : null;
    },
  },

  documents: {
    async list({ page, pageSize, q, status, from, to }) {
      const term = q.toLowerCase();
      const inRange = from ? docs.filter((d) => { const day = istDay(new Date(d.updatedAt)); return day >= from && day <= to; }) : docs;
      const searched = term
        ? inRange.filter((d) =>
            [d.productName, d.fileName, d.metadata.batchNumber, d.id].some((f) => f.toLowerCase().includes(term)),
          )
        : inRange;
      const counts = { all: searched.length, ok: 0, near_expiry: 0, expired: 0 };
      for (const d of searched) counts[statusOf(d)]++;
      const filtered = status === 'all' ? searched : searched.filter((d) => statusOf(d) === status);
      const sorted = [...filtered].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const start = (page - 1) * pageSize;
      return { items: sorted.slice(start, start + pageSize).map(toDto), total: filtered.length, counts };
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

    async orderedIds({ q, status, from, to }) {
      const { items } = await this.list({ page: 1, pageSize: docs.length, q, status, from, to });
      return items.map((d) => d.id);
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
};
