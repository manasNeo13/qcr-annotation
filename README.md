# QCR Annotation

Monorepo: review and correct label metadata (MFG, expiry, batch, MRP) on document images.

```
frontend/   React + TypeScript + Vite + MUI   (port 5173)
backend/    Node.js + Express (plain JS)      (port 4000)
style.md    Visual style guide
```

## Run

```bash
cd frontend && npm install && npm run dev
cd backend  && cp .env.example .env && npm install && npm run dev
```

Config: only `backend/.env` — `MONGODB_URI`, `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_KEY`, `AZURE_STORAGE_CONTAINER`. Frontend needs none.
No `MONGODB_URI` → in-memory demo data (login `annotator@neoqcr.com` / `demo`).
Fixed in code: port 4000, JWT 8h (random secret per start), SAS links 10 min, near expiry < 30% shelf life left.
Optional overrides: backend `PORT`, `JWT_SECRET`; frontend `VITE_PROXY_TARGET` (dev proxy), `VITE_API_URL`, `VITE_USE_MOCK=true`.

All `/api/documents` routes need `Authorization: Bearer <jwt>`. Validation errors → 400 `{ message, errors: { field: msg } }`. Concurrent edit → 409.

## API contract (frontend expects)

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| POST | `/api/auth/login` | `{ email, password }` | `{ token, user }` |
| GET | `/api/documents` | `page, q, status=ok\|near_expiry\|expired, from, to` (15 per page, IST days) | `{ items, total, page, pageSize, counts }` |
| GET | `/api/documents/dates` | `from, to` | `{ days: [{ date, count }], latest }` (calendar dots) |
| GET | `/api/documents/:id/neighbors` | `q, status, from, to` | `{ prevId, nextId, index, total }` |
| GET | `/api/documents/:id` | — | `DocumentItem` |
| PATCH | `/api/documents/:id` | `{ metadata }` | `DocumentItem` (previous values pushed to `history`) |

Types: `frontend/src/types/index.ts`. Status: expired if expiry < today, near expiry if < 30% shelf life left.
