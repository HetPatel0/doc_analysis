# Bookify Monorepo

This repository now contains both Bookify applications:

- `apps/backend` - FastAPI + LangChain backend
- `apps/frontend` - Next.js frontend

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

## Environment files

- Backend env: `apps/backend/.env`
- Frontend env: `apps/frontend/.env.local`

The frontend expects `NEXT_PUBLIC_API_URL`, and falls back to `http://127.0.0.1:8000`.
