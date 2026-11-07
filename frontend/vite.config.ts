import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // URL prefix the app is hosted under, e.g. BASE_PATH=/qcr → neophyte.ril.com/qcr/. Empty = root.
  const trimmed = (env.BASE_PATH || '').trim().replace(/^\/+|\/+$/g, '');
  const base = trimmed ? `/${trimmed}/` : '/';
  return {
    base,
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      proxy: {
        [`${base}api`]: { target: env.VITE_PROXY_TARGET || 'http://localhost:4000', changeOrigin: true },
      },
    },
    preview: { host: true, port: 4173 },
  };
});
