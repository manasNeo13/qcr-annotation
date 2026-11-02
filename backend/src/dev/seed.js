/** Dev-only seed data for DATA_SOURCE=memory. Mirrors frontend mock. */
import crypto from 'node:crypto';
import { toISODate } from '../lib/status.js';

const PRODUCTS = [
  'Paracetamol 500mg Tablets', 'Amoxicillin 250mg Capsules', 'Cetirizine 10mg Tablets', 'Vitamin D3 60K Softgels',
  'ORS Electrolyte Powder', 'Pantoprazole 40mg Tablets', 'Cough Syrup 100ml', 'Azithromycin 500mg Tablets',
  'Multivitamin Capsules', 'Ibuprofen 400mg Tablets', 'Antiseptic Liquid 250ml', 'Calcium + Zinc Tablets',
];

function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const DAY = 86_400_000;

export function seedUsers() {
  return [
    { id: 'u_demo', name: 'Demo Annotator', email: 'annotator@neoqcr.com', passwordHash: demoHash() },
  ];
}

export function seedDocuments() {
  const rand = rng(42);
  const now = Date.now();
  return Array.from({ length: 57 }, (_, i) => {
    const mfg = new Date(now - (Math.floor(rand() * 900) + 30) * DAY);
    const exp = new Date(now + (Math.floor(rand() * 900) - 200) * DAY);
    const created = new Date(now - Math.floor(rand() * 30) * DAY - i * 3_600_000).toISOString();
    return {
      id: `doc_${String(i + 1).padStart(4, '0')}`,
      productName: PRODUCTS[i % PRODUCTS.length],
      fileName: `IMG_${20260000 + i * 37}.jpg`,
      metadata: {
        mfgDate: toISODate(mfg),
        expiryDate: toISODate(exp > mfg ? exp : new Date(mfg.getTime() + 365 * DAY)),
        batchNumber: `B${Math.floor(rand() * 90000) + 10000}${String.fromCharCode(65 + (i % 26))}`,
        mrp: Math.round((rand() * 480 + 20) * 100) / 100,
      },
      version: 1,
      createdAt: created,
      updatedAt: created,
      history: [],
    };
  });
}

const fmtMY = (iso) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Fake label photo printing ORIGINAL values. */
export function labelImage(doc) {
  const m = doc.history[0]?.metadata ?? doc.metadata;
  const hue = (parseInt(doc.id.slice(-4), 10) * 47) % 360;
  const bars = Array.from({ length: 28 }, (_, k) => `<rect x="${520 + k * 6}" y="400" width="${k % 3 ? 2 : 4}" height="80" fill="#12171e"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="hsl(${hue},45%,92%)"/><stop offset="1" stop-color="hsl(${hue},40%,80%)"/>
  </linearGradient></defs>
  <rect width="800" height="600" fill="url(#g)"/>
  <rect x="90" y="70" width="620" height="460" rx="18" fill="#fff" stroke="hsl(${hue},35%,60%)" stroke-width="3" transform="rotate(-2 400 300)"/>
  <g transform="rotate(-2 400 300)" font-family="Arial, sans-serif" fill="#1b212c">
    <rect x="90" y="70" width="620" height="90" rx="18" fill="hsl(${hue},55%,42%)"/>
    <text x="130" y="128" font-size="34" font-weight="700" fill="#fff">${esc(doc.productName)}</text>
    <text x="130" y="230" font-size="30">MFG. DATE : ${fmtMY(m.mfgDate)}</text>
    <text x="130" y="290" font-size="30">EXP. DATE : ${fmtMY(m.expiryDate)}</text>
    <text x="130" y="350" font-size="30">B. NO. : ${esc(m.batchNumber)}</text>
    <text x="130" y="410" font-size="30" font-weight="700">M.R.P. ₹ ${m.mrp.toFixed(2)}</text>
    <text x="130" y="470" font-size="18" fill="#60696d">(Incl. of all taxes) · ${esc(doc.fileName)}</text>
    ${bars}
  </g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function demoHash() {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync('demo', salt, 64).toString('hex')}`;
}
