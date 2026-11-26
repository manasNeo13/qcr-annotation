import cors from 'cors';
import { RENEW_HEADER } from './middleware/auth.js';
import adminRouter from './routes/admin.js';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './config/env.js';
import { repo } from './repos/index.js';
import authRouter from './routes/auth.js';
import documentsRouter from './routes/documents.js';
import healthRouter from './routes/health.js';
import liveRouter from './routes/live.js';
import uploadRouter from './routes/upload.js';
import { closeAll as closeLive } from './services/live.js';
import { sasConfigured } from './services/sas.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(cors({ exposedHeaders: [RENEW_HEADER] })); // Bearer-token auth, no cookies → any origin OK
app.use(express.json({ limit: '1mb' }));
// API = per-user, token-bearing data → never cache. A cached 304 replays an old X-Session-Token
// header, which the client stores as a "renewed" token → expired session right after login.
app.set('etag', false);

// Everything lives under BASE_PATH (e.g. /qcr when hosted at neophyte.ril.com/qcr; '' = root).
const base = express.Router();
base.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
base.use('/api/health', healthRouter);
base.use('/api/auth', authRouter);
base.use('/api/documents', documentsRouter);
base.use('/api/admin', adminRouter);
base.use('/api/live', liveRouter);
base.use('/api/upload_client_revalidate_data', uploadRouter);

// Single-image deploy: serve the built frontend (set STATIC_DIR, e.g. in Docker) with SPA fallback.
if (process.env.STATIC_DIR && fs.existsSync(process.env.STATIC_DIR)) {
  const dir = path.resolve(process.env.STATIC_DIR);
  base.use('/assets', express.static(path.join(dir, 'assets'), { immutable: true, maxAge: '1y' }));
  base.use(express.static(dir, { index: false }));
  base.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.set('Cache-Control', 'no-cache').sendFile(path.join(dir, 'index.html'));
  });
  if (env.BASE_PATH) app.get('/', (req, res) => res.redirect(`${env.BASE_PATH}/`));
}

app.use(env.BASE_PATH || '/', base);

app.use((req, res) => res.status(404).json({ message: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);  res.status(status).json({
    message: status >= 500 ? 'Internal server error' : err.message || 'Request failed',
    ...(err.details && { errors: err.details }),
    ...(status < 500 && typeof err.code === 'string' && { code: err.code }),
  });
});

await repo.init();
if (!sasConfigured) console.warn('[sas] Azure not configured — image refs returned unsigned');

const server = app.listen(env.PORT, '0.0.0.0', () => console.log(`API listening on :${env.PORT}`));

const shutdown = async (sig) => {
  console.log(`${sig} — shutting down`);
  closeLive();
  server.close();
  await repo.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
