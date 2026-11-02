import 'dotenv/config';
import crypto from 'node:crypto';

/**
 * Only 4 values come from .env: MONGODB_URI + 3 Azure storage keys.
 * Everything else is fixed here (PORT may be overridden by the host, e.g. Docker).
 * No MONGODB_URI → in-memory demo data (login annotator@neoqcr.com / demo).
 */
const MONGODB_URI = process.env.MONGODB_URI || '';

export const env = {
  PORT: Number(process.env.PORT) || 4000,
  DATA_SOURCE: MONGODB_URI ? 'mongo' : 'memory',
  MONGODB_URI, // DB name taken from the URI path (e.g. /neo-icr)
  // Random per start → users sign in again after a restart. Optional JWT_SECRET env keeps sessions across restarts.
  JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
  JWT_EXPIRES_IN: '8h',
  AZURE_STORAGE_ACCOUNT: process.env.AZURE_STORAGE_ACCOUNT || '',
  AZURE_STORAGE_KEY: process.env.AZURE_STORAGE_KEY || '',
  AZURE_STORAGE_CONTAINER: process.env.AZURE_STORAGE_CONTAINER || '',
  SAS_TTL_MINUTES: 10,
};
