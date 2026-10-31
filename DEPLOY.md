# Deploying Bookify

Topology:

| Piece | Host | Root directory |
|---|---|---|
| Frontend (Next.js 16) | Vercel | `apps/frontend` |
| Backend (FastAPI) | Railway | `apps/backend` |
| Database (Postgres) | Neon | — |

The frontend owns auth, guest limits, document rows, and messages. The backend
owns PDF files, vector indexes, and generation. They talk over
`BACKEND_API_URL` with a shared secret header.

## Backend (Railway)

- **Root directory:** `apps/backend`
- **Install:** `pip install -r requirements.txt` (do not install `requirements-dev.txt`)
- **Start:** `bash start_prod.sh`
- **Health check:** `GET /health` → `{"status":"ok"}`

`start_prod.sh` uses `apps/backend/.venv/bin/python` when it exists and falls
back to `python3` (containers, Railway). It binds `0.0.0.0:$PORT` and honours
`X-Forwarded-*` from the platform proxy.

### Environment

| Variable | Required | Notes |
|---|---|---|
| `MISTRAL_API_KEY` | yes | Embeddings fail without it; OCR uses it too |
| `MISTRAL_MODEL` | yes | `open-mistral-nemo` works on the current plan; `mistral-small`/`medium` return `x-ratelimit-limit-req-minute: 0` |
| `BOOKIFY_API_SECRET` | yes | Random 32+ chars; must equal the frontend's `BACKEND_API_SECRET` |
| `CORS_ORIGINS` | yes | Your Vercel URL, comma-separated |
| `BOOKIFY_STORAGE_DIR` | yes | Point at a mounted volume, e.g. `/data` |
| `BOOKIFY_MAX_UPLOAD_MB` | no | Default 20; keep in sync with `NEXT_PUBLIC_MAX_UPLOAD_MB` |
| `RAG_*` | no | Chunk size/overlap, fetch-k, top-k |
| `OCR_PROVIDER` | no | `auto` (default), `mistral`, `tesseract`, `off` |
| `OCR_MAX_PAGES` | no | Cost guard; default 40 |
| `BOOKIFY_WARM_ON_STARTUP` | no | **Set `false` on Railway.** Warming loads tiktoken + the embedding stack and can push startup past the health-check window |
| `SENTRY_DSN` | no | Blank disables error reporting |

### State: mount a volume until 3.1 lands

The backend writes to local disk:

```
$BOOKIFY_STORAGE_DIR/uploads/      <- original PDFs
$BOOKIFY_STORAGE_DIR/vectorstores/ <- one Chroma dir + status JSON per document
```

Without a persistent volume, **every redeploy wipes indexes while Neon keeps the
document rows** — the UI then shows documents whose status endpoint returns 404.
Mount a Railway volume at `/data` and set `BOOKIFY_STORAGE_DIR=/data`.

This is the main reason Phase 3.1 (pgvector + object storage) exists. Until
then, run a single backend replica: two replicas would index into two different
disks behind one load balancer.

### OCR

- Default (`OCR_PROVIDER=auto`) prefers the **local tesseract** engine when
  `tesseract` + `poppler-utils` are installed, then falls back to **Mistral OCR**
  when `MISTRAL_API_KEY` is set. On Railway without those packages it uses the
  API only, so no build changes are needed.
- To use the free local engine instead, install the binaries in the image
  (`nixpacks.toml` or a Dockerfile):

  ```toml
  [phases.setup]
  aptPkgs = ["tesseract-ocr", "poppler-utils"]
  ```

  then set `OCR_PROVIDER=tesseract`. Budget ~1–3s per page at `OCR_DPI=200`.
- `OCR_MAX_PAGES` caps both engines; raise it deliberately for long scans.
- OCR only runs when the text layer is thinner than
  `OCR_MIN_CHARS_PER_PAGE × pages`, so normal PDFs are unaffected.

## Frontend (Vercel)

- **Root directory:** `apps/frontend`
- Build: `npm run build` (runs `prebuild` to copy the PDF worker)
- **Node:** 22

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Neon pooled connection string |
| `BETTER_AUTH_SECRET` | yes | 32+ chars, different from the backend secret |
| `BETTER_AUTH_URL` | yes | Public app URL |
| `BETTER_AUTH_ALLOWED_HOSTS` | yes | Comma-separated hosts |
| `BETTER_AUTH_TRUSTED_ORIGINS` | yes | Comma-separated origins |
| `BACKEND_API_URL` | yes | Railway service URL, no trailing slash |
| `BACKEND_API_SECRET` | yes | Same value as Railway `BOOKIFY_API_SECRET` |
| `NEXT_PUBLIC_APP_URL` | yes | Public app URL |
| `NEXT_PUBLIC_MAX_UPLOAD_MB` | no | Must match the backend limit |
| `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_*` | no | Blank disables Sentry |

## Database (Neon)

Drizzle migrations live in `apps/frontend/drizzle/` (`0000`–`0002`). Apply with:

```bash
cd apps/frontend
npm run db:push
```

They are additive: `usage_subject.active_document_id`, the `message` table, and
the workspace tables. Run this before deploying a build that expects them.

## Deploy checklist

1. Backend env set, volume mounted, `BOOKIFY_WARM_ON_STARTUP=false`.
2. Frontend env set, `BACKEND_API_SECRET` identical to the backend secret.
3. Migrations applied.
4. `GET /health` returns 200 from the public backend URL.
5. Upload a PDF → status goes `queued → indexing → ready`.
6. Ask a question → tokens stream, citations resolve to pages.
7. `curl -H "X-Bookify-Secret: wrong" $BACKEND/documents/x` returns 401.
8. Redeploy the backend and confirm the document still opens (volume works).

## CI and evals

- `.github/workflows/ci.yml` runs on every push/PR: backend `ruff` + `pytest`,
  frontend `tsc` + `eslint` + `next build`. Everything is offline — no API keys
  needed.
- `.github/workflows/rag-eval.yml` is manual (`workflow_dispatch`) and needs a
  `MISTRAL_API_KEY` repository secret. See `apps/backend/RAG.md` for the golden
  set, thresholds, and the current known failure.

## Known deploy gaps (Phase 3.1)

- Per-document Chroma directories on a single volume: no horizontal scaling, and
  deleting a document deletes its index.
- Uploaded PDFs live on the volume; there is no object storage or signed-URL
  access.
- Background indexing runs in-process (FastAPI `BackgroundTasks`), so a restart
  mid-index leaves a document stuck in `indexing`. Status polling surfaces this,
  but there is no automatic retry yet.
