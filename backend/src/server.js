import cors from 'cors';
import express from 'express';
import { env } from './config/env.js';
import { repo } from './repos/index.js';
import authRouter from './routes/auth.js';
import documentsRouter from './routes/documents.js';
import healthRouter from './routes/health.js';
import { sasConfigured } from './services/sas.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(cors()); // Bearer-token auth, no cookies → any origin OK
app.use(express.json({ limit: '1mb' }));

app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/documents', documentsRouter);


app.use((req, res) => res.status(404).json({ message: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    message: status >= 500 ? 'Internal server error' : err.message || 'Request failed',
    ...(err.details && { errors: err.details }),
  });
});

await repo.init();
if (!sasConfigured) console.warn('[sas] Azure not configured — image refs returned unsigned');

const server = app.listen(env.PORT, '0.0.0.0', () => console.log(`API listening on :${env.PORT}`));

const shutdown = async (sig) => {
  console.log(`${sig} — shutting down`);
  server.close();
  await repo.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
