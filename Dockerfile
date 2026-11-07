# ---- build frontend ----
FROM node:22-alpine AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# URL prefix the app is hosted under (e.g. /qcr). Baked into the frontend bundle AND used by the backend.
ARG BASE_PATH=
# Default API: same-origin <BASE_PATH>/api, served by the backend below.
ARG VITE_API_URL=
ARG VITE_USE_MOCK=
ENV BASE_PATH=$BASE_PATH VITE_API_URL=$VITE_API_URL VITE_USE_MOCK=$VITE_USE_MOCK
RUN npm run build

# ---- runtime: backend API + built frontend ----
FROM node:22-alpine
ARG BASE_PATH=
ENV NODE_ENV=production \
    STATIC_DIR=/app/public \
    BASE_PATH=$BASE_PATH
WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY backend/src ./src
COPY --from=frontend /frontend/dist ./public

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-4000}${BASE_PATH}/api/health || exit 1

CMD ["node", "src/server.js"]
