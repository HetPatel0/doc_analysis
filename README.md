# Bookify Monorepo

This repository now contains both Bookify applications:

- `apps/backend` - FastAPI + LangChain backend
- `apps/frontend` - Next.js frontend

## Production Architecture

- Frontend: Vercel
- Backend: Railway
- Database: Neon Postgres

The frontend owns auth, guest limits, and database writes. The backend handles
PDF indexing and chat generation.

## Local Development

Run the frontend and backend in separate terminals.

### 1. Create env files

Copy the example env files:

```bash
cp apps/frontend/.env.local.example apps/frontend/.env.local
cp apps/backend/.env.example apps/backend/.env
```

On Windows PowerShell:

```powershell
Copy-Item apps\frontend\.env.local.example apps\frontend\.env.local
Copy-Item apps\backend\.env.example apps\backend\.env
```

Update the keys listed in [Environment Keys](#environment-keys).

### 2. Install frontend dependencies

Using Bun from the repo root:

```bash
bun install
```

Using npm from the repo root:

```bash
npm run install:frontend
```

### 3. Start the frontend

Using Bun from the repo root:

```bash
bun run dev
```

Using Bun from the frontend app:

```bash
cd apps/frontend
bun run dev
```

Using npm from the repo root:

```bash
npm run dev:frontend
```

The frontend runs at `http://localhost:3000`.

### 4. Install backend dependencies

Create and activate a Python virtual environment:

```bash
cd apps/backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

On Windows PowerShell:

```powershell
cd apps\backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 5. Start the backend

Run this from `apps/backend` after activating the virtual environment:

```bash
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

The backend runs at `http://127.0.0.1:8000`.

## Environment Keys

- Backend env: `apps/backend/.env`
- Backend example env: `apps/backend/.env.example`
- Frontend env: `apps/frontend/.env.local`
- Frontend example env: `apps/frontend/.env.local.example`

### Frontend Env

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_ALLOWED_HOSTS=localhost:3000,127.0.0.1:3000
BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
BACKEND_API_URL=http://127.0.0.1:8000
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=...
NEXT_PUBLIC_MAX_UPLOAD_MB=20
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_DSN=
SENTRY_ORG=
SENTRY_PROJECT=
SENTRY_AUTH_TOKEN=
```

Required frontend keys:

- `DATABASE_URL`: Postgres connection string used by Drizzle and Better Auth.
- `BETTER_AUTH_SECRET`: Random 32+ character secret for Better Auth sessions.
- `BACKEND_API_URL`: Backend API URL for server-side frontend calls.
- `BACKEND_API_SECRET`: Same value as backend `BOOKIFY_API_SECRET`.

Recommended frontend keys:

- `NEXT_PUBLIC_APP_URL`: Public frontend URL. Use `http://localhost:3000` in dev.
- `BETTER_AUTH_URL`: Better Auth base URL. Use `http://localhost:3000` in dev.
- `BETTER_AUTH_ALLOWED_HOSTS`: Comma-separated hosts Better Auth can use.
- `BETTER_AUTH_TRUSTED_ORIGINS`: Comma-separated trusted origins for auth requests.
- `NEXT_PUBLIC_API_URL`: Optional browser-visible backend API fallback if `BACKEND_API_URL` is not set.
- `NEXT_PUBLIC_MAX_UPLOAD_MB`: Client-side upload size guard. Keep in sync with backend `BOOKIFY_MAX_UPLOAD_MB`.
- `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN`: Optional Sentry DSNs for browser and server error reporting. Leave blank to disable.
- `SENTRY_AUTH_TOKEN`: Optional Sentry auth token for source map uploads during `next build`.

`BETTER_AUTH_ALLOWED_HOSTS` is used for dynamic Better Auth base URL handling,
which makes Vercel preview and production domains safer to support.

### Backend Env

```env
MISTRAL_API_KEY=...
MISTRAL_MODEL=open-mistral-nemo
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
BOOKIFY_API_SECRET=...
BOOKIFY_MAX_UPLOAD_MB=20
BOOKIFY_STORAGE_DIR=
BOOKIFY_UPLOADS_DIR=
BOOKIFY_VECTORSTORES_DIR=
BOOKIFY_WARM_ON_STARTUP=true
OCR_PROVIDER=auto
OCR_MIN_CHARS_PER_PAGE=100
OCR_MAX_PAGES=40
SENTRY_DSN=
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
```

Required backend keys:

- `MISTRAL_API_KEY`: Mistral API key used for embeddings and chat generation.
- `BOOKIFY_API_SECRET`: Shared secret the frontend sends as `X-Bookify-Secret`. Leave empty only for local dev without auth; always set in production.

Recommended backend keys:

- `MISTRAL_MODEL`: Mistral chat model. Defaults to `open-mistral-nemo` (`mistral-small`/`mistral-medium` return a zero per-minute rate limit on the current plan).
- `CORS_ORIGINS`: Comma-separated frontend origins allowed by FastAPI CORS.
- `BOOKIFY_STORAGE_DIR`: Base storage directory for uploads and vector indexes.
- `BOOKIFY_UPLOADS_DIR`: Upload storage directory. Defaults under `BOOKIFY_STORAGE_DIR`.
- `BOOKIFY_VECTORSTORES_DIR`: Vector index storage directory. Defaults under `BOOKIFY_STORAGE_DIR`.
- `BOOKIFY_WARM_ON_STARTUP`: Whether to warm dependencies on startup. Set `false` on Railway so health checks pass quickly.
- `OCR_PROVIDER`: OCR fallback for scanned PDFs: `auto` (local tesseract, then Mistral OCR), `mistral`, `tesseract`, or `off`.
- `OCR_MIN_CHARS_PER_PAGE`: Text-density threshold below which a page is treated as a scan. Default `100`.
- `OCR_MAX_PAGES`: Safety/cost cap on OCR pages. Default `40`.
- `SENTRY_DSN`: Optional Sentry DSN for backend error reporting. Leave blank to disable.
- `SENTRY_ENVIRONMENT`: Sentry environment name. Defaults to `production`.
- `SENTRY_TRACES_SAMPLE_RATE`: Sentry performance sample rate. Defaults to `0.1`.

If `BOOKIFY_STORAGE_DIR` is set, the backend will store uploads and vector
indexes under that directory by default. On Railway, point this at your mounted
volume path.

## Tests, lint, and RAG evals

Backend (offline, no API key needed):

```bash
cd apps/backend
pip install -r requirements.txt -r requirements-dev.txt
ruff check .
pytest -q
```

Frontend:

```bash
cd apps/frontend
npx tsc --noEmit
npm run lint
npm run build
```

Retrieval quality against the golden document (needs `MISTRAL_API_KEY`):

```bash
cd apps/backend
.venv/bin/python scripts/rag_eval.py                 # retrieval only
.venv/bin/python scripts/rag_eval.py --mode full     # answers + citations
```

See [apps/backend/RAG.md](apps/backend/RAG.md) for the golden set, scoring, and
the current baseline. CI runs the offline checks on every push and PR
(`.github/workflows/ci.yml`); the eval is a manual workflow.

## Deployment Notes

### Frontend on Vercel

- Root directory: `apps/frontend`
- Build command: default
- Install command: default
- Set all frontend env vars in the Vercel dashboard
- Run `bun run db:push` once against the production Neon database

Recommended production values:

```env
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
BETTER_AUTH_URL=https://your-app.vercel.app
BETTER_AUTH_ALLOWED_HOSTS=your-app.vercel.app,*.vercel.app
BETTER_AUTH_TRUSTED_ORIGINS=https://your-app.vercel.app
BACKEND_API_URL=https://your-backend-domain
NEXT_PUBLIC_API_URL=https://your-backend-domain
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=...
NEXT_PUBLIC_MAX_UPLOAD_MB=20
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_DSN=
SENTRY_ORG=
SENTRY_PROJECT=
SENTRY_AUTH_TOKEN=
```

### Backend on Railway

- Root directory: `apps/backend`
- Start command: `bash ./start_prod.sh`
- Expose the service publicly
- Add a persistent volume and point storage env vars at it
- Keep `BOOKIFY_WARM_ON_STARTUP=false` so the health check does not wait on model warm-up
- Full matrix and checklist: [DEPLOY.md](DEPLOY.md)

Recommended production values:

```env
MISTRAL_API_KEY=...
MISTRAL_MODEL=open-mistral-nemo
CORS_ORIGINS=https://your-app.vercel.app
BOOKIFY_STORAGE_DIR=/app/data
BOOKIFY_UPLOADS_DIR=/app/data/uploads
BOOKIFY_VECTORSTORES_DIR=/app/data/vectorstores
BOOKIFY_WARM_ON_STARTUP=false
OCR_PROVIDER=auto
OCR_MAX_PAGES=40
SENTRY_DSN=
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
```

The frontend expects `BACKEND_API_URL` for server-to-server calls and falls back
to `NEXT_PUBLIC_API_URL` only if it is unset.
