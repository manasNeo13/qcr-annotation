import 'dotenv/config';
import crypto from 'node:crypto';

/**
 * Only 4 values come from .env: MONGODB_URI + 3 Azure storage keys.
 * Everything else is fixed here (PORT may be overridden by the host, e.g. Docker).
 * No MONGODB_URI → in-memory demo data (login annotator@neoqcr.com / demo).
 */
const MONGODB_URI = process.env.MONGODB_URI || '';

/** "qcr", "/qcr/", "/qcr" → "/qcr"; "", "/" → "" */
function normalizeBasePath(p = '') {
  const trimmed = p.trim().replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}` : '';
}

export const env = {
  PORT: Number(process.env.PORT) || 4000,
  // URL prefix the app is hosted under, e.g. "/qcr" → neophyte.ril.com/qcr. Empty = served at root.
  BASE_PATH: normalizeBasePath(process.env.BASE_PATH),
  DATA_SOURCE: MONGODB_URI ? 'mongo' : 'memory',
  MONGODB_URI, // DB name taken from the URI path (e.g. /neo-icr)
  // Stable across restarts/redeploys: derived from MONGODB_URI (no extra secret in prod .env).
  // Anyone with the URI could forge tokens — they already have full DB access. JWT_SECRET env overrides.
  // No URI (memory demo) → random per start.
  JWT_SECRET:
    process.env.JWT_SECRET ||
    (MONGODB_URI
      ? crypto.createHash('sha256').update(`qcr-annotation:jwt:${MONGODB_URI}`).digest('hex')
      : crypto.randomBytes(32).toString('hex')),
  // Idle timeout: token lives 8h, renewed on activity (see middleware/auth.js) → only 8h of no API calls logs out.
  JWT_EXPIRES_IN: '8h',
  JWT_RENEW_AFTER_S: 5 * 60, // re-issue at most every 5 min
  AZURE_STORAGE_ACCOUNT: process.env.AZURE_STORAGE_ACCOUNT || '',
  AZURE_STORAGE_KEY: process.env.AZURE_STORAGE_KEY || '',
  AZURE_STORAGE_CONTAINER: process.env.AZURE_STORAGE_CONTAINER || '',
  SAS_TTL_MINUTES: 10,
};
