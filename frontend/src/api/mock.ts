/**
 * In-browser mock backend. Used while VITE_USE_MOCK=true.
 * Persists edits in localStorage so history survives reloads.
 * Delete once the real backend is wired.
 */
import dayjs from 'dayjs';
import type {
  DayCounts,
  DayScope,
  ListFilter,
  DocMetadata,
  DocumentItem,
  FilterOptions,
  GroupItem,
  GroupResponse,
  ListParams,
  ListResponse,
  LoginResponse,
  Neighbors,
  StatusFilter,
} from '../types';
import { NONE_KEY } from '../types';
import { getStatus } from '../utils/status';
import { ApiError } from './client';

const STORE_KEY = 'qcr.mock.docs.v1';
const delay = (ms = 350) => new Promise((r) => setTimeout(r, ms));

const PRODUCTS = [
  'Paracetamol 500mg Tablets',
  'Amoxicillin 250mg Capsules',
  'Cetirizine 10mg Tablets',
  'Vitamin D3 60K Softgels',
  'ORS Electrolyte Powder',
  'Pantoprazole 40mg Tablets',
  'Cough Syrup 100ml',
  'Azithromycin 500mg Tablets',
  'Multivitamin Capsules',
  'Ibuprofen 400mg Tablets',
  'Antiseptic Liquid 250ml',
  'Calcium + Zinc Tablets',
];

// Deterministic PRNG so mock data is stable across reloads.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function seed(): DocumentItem[] {
  const rand = rng(42);
  const today = dayjs();
  return Array.from({ length: 57 }, (_, i) => {
    const mfg = today.subtract(Math.floor(rand() * 900) + 30, 'day');
    // Spread expiries: some past, some within 90 days, most later.
    const expOffset = Math.floor(rand() * 900) - 200;
    const exp = today.add(expOffset, 'day');
    const metadata: DocMetadata = {
      mfgDate: mfg.format('YYYY-MM-DD'),
      expiryDate: (exp.isAfter(mfg) ? exp : mfg.add(365, 'day')).format('YYYY-MM-DD'),
      batchNumber: `B${String(Math.floor(rand() * 90000) + 10000)}${String.fromCharCode(65 + (i % 26))}`,
      mrp: Math.round((rand() * 480 + 20) * 100) / 100,
    };
    const created = today
      .subtract(Math.floor(rand() * 30), 'day')
      .subtract(i, 'hour')
      .toISOString();
    return {
      id: `doc_${String(i + 1).padStart(4, '0')}`,
      productName: PRODUCTS[i % PRODUCTS.length],
      fileName: `IMG_${20260000 + i * 37}.jpg`,
      imageUrl: '',
      metadata,
      status: getStatus(metadata.mfgDate, metadata.expiryDate),
      version: 1,
      createdAt: created,
      updatedAt: created,
      history: [],
    };
  });
}

function load(): DocumentItem[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* corrupt store → reseed */
  }
  const docs = seed();
  localStorage.setItem(STORE_KEY, JSON.stringify(docs));
  return docs;
}

const save = (docs: DocumentItem[]) => localStorage.setItem(STORE_KEY, JSON.stringify(docs));

/** Fake product-label photo. Prints the ORIGINAL values, like a real scan would. */
function labelImage(doc: DocumentItem): string {
  const m = doc.history[0]?.metadata ?? doc.metadata;
  const hue = (parseInt(doc.id.slice(-4), 10) * 47) % 360;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="hsl(${hue},45%,92%)"/><stop offset="1" stop-color="hsl(${hue},40%,80%)"/>
  </linearGradient></defs>
  <rect width="800" height="600" fill="url(#g)"/>
  <rect x="90" y="70" width="620" height="460" rx="18" fill="#fff" stroke="hsl(${hue},35%,60%)" stroke-width="3" transform="rotate(-2 400 300)"/>
  <g transform="rotate(-2 400 300)" font-family="Arial, sans-serif" fill="#1b212c">
    <rect x="90" y="70" width="620" height="90" rx="18" fill="hsl(${hue},55%,42%)"/>
    <text x="130" y="128" font-size="34" font-weight="700" fill="#fff">${esc(doc.productName)}</text>
    <text x="130" y="230" font-size="30">MFG. DATE : ${dayjs(m.mfgDate).format('MM/YYYY')}</text>
    <text x="130" y="290" font-size="30">EXP. DATE : ${dayjs(m.expiryDate).format('MM/YYYY')}</text>
    <text x="130" y="350" font-size="30">B. NO. : ${esc(m.batchNumber)}</text>
    <text x="130" y="410" font-size="30" font-weight="700">M.R.P. ₹ ${(m.mrp ?? 0).toFixed(2)}</text>
    <text x="130" y="470" font-size="18" fill="#60696d">(Incl. of all taxes) · ${esc(doc.fileName)}</text>
    ${Array.from({ length: 28 }, (_, k) => `<rect x="${520 + k * 6}" y="400" width="${k % 3 ? 2 : 4}" height="80" fill="#12171e"/>`).join('')}
  </g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const withImage = (d: DocumentItem): DocumentItem => ({
  ...d,
  status: getStatus(d.metadata.mfgDate, d.metadata.expiryDate),
  imageUrl: labelImage(d),
});

/** Mock EAN = product name. */
const eanOf = (d: DocumentItem) => d.productName;
const keyMatch = (v: string, want?: string) => !want || (want === NONE_KEY ? !v : v === want);

function filterDocs({ q = '', from, to, ean, batch }: ListFilter) {
  const day = (d: DocumentItem) => dayjs(d.updatedAt).format('YYYY-MM-DD');
  const term = q.trim().toLowerCase();
  return load()
    .map(withImage)
    .filter((d) => !from || (day(d) >= from && day(d) <= (to ?? from)))
    .filter(
      (d) =>
        !term || [d.productName, d.fileName, d.metadata.batchNumber, d.id].some((f) => f.toLowerCase().includes(term)),
    )
    .filter((d) => keyMatch(eanOf(d), ean) && keyMatch(d.metadata.batchNumber, batch));
}

export const mockApi = {
  async login(email: string, password: string): Promise<LoginResponse> {
    await delay(500);
    if (!email || !password) throw new ApiError('Email and password are required', 400);
    const name = email
      .split('@')[0]
      .replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    return {
      token: `mock.${btoa(email)}.${Date.now()}`,
      user: { id: 'u_mock', name: name || 'Annotator', email },
    };
  },

  async listDocuments({ page, pageSize, status = 'all', ...f }: ListParams): Promise<ListResponse> {
    await delay();
    const searched = filterDocs(f);
    const counts: Record<StatusFilter, number> = {
      all: searched.length,
      ok: 0,
      near_expiry: 0,
      expired: 0,
    };
    searched.forEach((d) => counts[d.status]++);
    const filtered = status === 'all' ? searched : searched.filter((d) => d.status === status);
    filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const start = (page - 1) * pageSize;
    return {
      items: filtered.slice(start, start + pageSize),
      total: filtered.length,
      page,
      pageSize,
      counts,
    };
  },

  async listGroups(by: 'ean' | 'batch', { page, pageSize, status = 'all', ...f }: ListParams): Promise<GroupResponse> {
    await delay();
    const rows = filterDocs(f);
    const counts: Record<StatusFilter, number> = { all: rows.length, ok: 0, near_expiry: 0, expired: 0 };
    rows.forEach((d) => counts[d.status]++);
    const map = new Map<string, GroupItem & { set: Set<string> }>();
    for (const d of rows) {
      if (status !== 'all' && d.status !== status) continue;
      const key = (by === 'ean' ? eanOf(d) : d.metadata.batchNumber) || NONE_KEY;
      const g = map.get(key) ?? {
        key,
        total: 0,
        counts: { ok: 0, near_expiry: 0, expired: 0 },
        latest: null,
        set: new Set<string>(),
      };
      g.total++;
      g.counts[d.status]++;
      g.set.add(d.metadata.batchNumber || NONE_KEY);
      if (!g.latest || d.updatedAt > g.latest) g.latest = d.updatedAt;
      map.set(key, g);
    }
    const byLatest = (a: GroupItem, b: GroupItem) => (b.latest ?? '').localeCompare(a.latest ?? '');
    const all = [...map.values()].sort((a, b) =>
      by === 'ean' ? b.set.size - a.set.size || b.total - a.total || byLatest(a, b) : byLatest(a, b),
    );
    const start = (page - 1) * pageSize;
    return {
      items: all
        .slice(start, start + pageSize)
        .map(({ set, ...g }) => ({ ...g, ...(by === 'ean' ? { batches: set.size } : {}) })),
      total: all.length,
      page,
      pageSize,
      counts,
    };
  },

  async getFilterOptions(): Promise<FilterOptions> {
    return { clients: [] };
  },

  async getDays(from: string, to: string, _scope?: DayScope): Promise<DayCounts> {
    void _scope; // mock has no clients
    const days = new Map<string, number>();
    let latest: string | null = null;
    for (const d of load()) {
      const day = dayjs(d.updatedAt).format('YYYY-MM-DD');
      if (!latest || day > latest) latest = day;
      if (day >= from && day <= to) days.set(day, (days.get(day) ?? 0) + 1);
    }
    return { days: [...days].sort().map(([date, count]) => ({ date, count })), latest };
  },

  async getNeighbors(id: string, filter: ListFilter): Promise<Neighbors> {
    const { items } = await this.listDocuments({ page: 1, pageSize: 100000, ...filter });
    const i = items.findIndex((d) => d.id === id);
    return {
      prevId: items[i - 1]?.id ?? null,
      nextId: i >= 0 ? (items[i + 1]?.id ?? null) : null,
      index: i,
      total: items.length,
    };
  },

  async getDocument(id: string): Promise<DocumentItem> {
    await delay(250);
    const doc = load().find((d) => d.id === id);
    if (!doc) throw new ApiError('Document not found', 404);
    return withImage(doc);
  },

  async updateDocument(id: string, metadata: DocMetadata, editedBy: string): Promise<DocumentItem> {
    await delay(500);
    const docs = load();
    const idx = docs.findIndex((d) => d.id === id);
    if (idx < 0) throw new ApiError('Document not found', 404);
    const cur = docs[idx];
    const now = new Date().toISOString();
    const next: DocumentItem = {
      ...cur,
      metadata,
      version: cur.version + 1,
      updatedAt: now,
      updatedBy: editedBy,
      history: [
        ...cur.history,
        {
          version: cur.version,
          metadata: cur.metadata,
          editedBy: cur.updatedBy ?? 'system',
          editedAt: cur.updatedAt,
        },
      ],
    };
    docs[idx] = next;
    save(docs);
    return withImage(next);
  },
};
