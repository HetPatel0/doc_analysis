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

## Run the frontend

```powershell
npm run install:frontend
npm run dev:frontend
```

The frontend runs from `apps/frontend`.

## Run the backend

```powershell
powershell -ExecutionPolicy Bypass -File .\apps\backend\start_dev.ps1
```

Or use the root script:

```powershell
npm run dev:backend
```

The backend defaults to `http://127.0.0.1:8000`.

For a production-style local start:

```bash
npm run start:backend
```

## Environment files

- Backend env: `apps/backend/.env`
- Backend example env: `apps/backend/.env.example`
- Frontend env: `apps/frontend/.env.local`
- Frontend example env: `apps/frontend/.env.local.example`

## Frontend Env

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_ALLOWED_HOSTS=localhost:3000,127.0.0.1:3000
BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
BACKEND_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=...
```

`BETTER_AUTH_ALLOWED_HOSTS` is used for dynamic Better Auth base URL handling,
which makes Vercel preview and production domains safer to support.

## Backend Env

```env
MISTRAL_API_KEY=...
MISTRAL_MODEL=mistral-small-2506
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
BOOKIFY_STORAGE_DIR=
BOOKIFY_UPLOADS_DIR=
BOOKIFY_VECTORSTORES_DIR=
BOOKIFY_WARM_ON_STARTUP=true
```

If `BOOKIFY_STORAGE_DIR` is set, the backend will store uploads and vector
indexes under that directory by default. On Railway, point this at your mounted
volume path.

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
```

### Backend on Railway

- Root directory: `apps/backend`
- Start command: `bash ./start_prod.sh`
- Expose the service publicly
- Add a persistent volume and point storage env vars at it

Recommended production values:

```env
MISTRAL_API_KEY=...
MISTRAL_MODEL=mistral-small-2506
CORS_ORIGINS=https://your-app.vercel.app
BOOKIFY_STORAGE_DIR=/app/data
BOOKIFY_UPLOADS_DIR=/app/data/uploads
BOOKIFY_VECTORSTORES_DIR=/app/data/vectorstores
BOOKIFY_WARM_ON_STARTUP=true
```

The frontend expects `BACKEND_API_URL` for server-to-server calls and falls back
to `NEXT_PUBLIC_API_URL` only if it is unset.
