# Deploying Bookify

Topology:

| Piece | Host | Root directory |
|---|---|---|
| Frontend (Next.js 16) | Vercel | `apps/frontend` |
| Backend (FastAPI) | Railway | `apps/backend` |
| Database (Postgres) | Neon | — |

The frontend owns auth, guest limits, document rows, and messages. The backend
owns document files, the vector index (Postgres + pgvector), and generation. They
talk over `BACKEND_API_URL` with a shared secret header. Both services use the
same Neon database; the backend only touches `document_index` and
`document_chunk`.

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
| `DATABASE_URL` | yes | Same Neon pooled connection string as the frontend; pgvector store |
| `BOOKIFY_STORAGE_DIR` | yes | Point at a mounted volume, e.g. `/data` (uploads only) |
| `BOOKIFY_MAX_UPLOAD_MB` | no | Default 20; keep in sync with `NEXT_PUBLIC_MAX_UPLOAD_MB` |
| `BOOKIFY_STORE` | no | `postgres` (default) or `memory` for DB-less local runs |
| `RAG_EMBEDDING_DIM` | no | Default 1024 (`mistral-embed`); changing it requires a reindex |
| `RAG_EMBEDDING_BATCH_SIZE` | no | Chunks per embedding call; default 64 |
| `RAG_*` | no | Chunking (`RAG_CHUNK_STRATEGY=recursive` default, `semantic` opt-in), size/overlap, fetch-k, top-k. Switching chunk strategy requires a reindex |
| `OCR_PROVIDER` | no | `auto` (default), `mistral`, `tesseract`, `off` |
| `OCR_MAX_PAGES` | no | Cost guard; default 40 |
| `BOOKIFY_URL_IMPORT` | no | Enables URL import; default `true`. Requires outbound HTTPS |
| `BOOKIFY_URL_IMPORT_TIMEOUT` | no | Fetch timeout in seconds; default 10 |
| `BOOKIFY_URL_IMPORT_MAX_REDIRECTS` | no | Redirects followed per import; default 3 |
| `BOOKIFY_URL_IMPORT_MAX_MB` | no | Downloaded page size cap; default 5 |
| `BOOKIFY_WARM_ON_STARTUP` | no | Warms imports + tiktoken in a background thread; safe to leave enabled because it no longer blocks the health check |
| `BOOKIFY_INDEX_STALE_SECONDS` | no | Documents stuck in `queued`/`indexing` longer than this are `stalled` and retryable; default 900 |
| `SENTRY_DSN` | no | Blank disables error reporting |

### State: Neon for vectors, volume for uploads

Since Phase 3.1 the backend keeps its index in Postgres:

```
Neon: document_index   <- status, source_kind/mime_type, chunk count, insights
Neon: document_chunk   <- chunk text + vector(1024) embedding, HNSW cosine index
$BOOKIFY_STORAGE_DIR/uploads/  <- original PDF/DOCX/TXT/MD files and imported URL text
```

The tables and the `vector` extension are created lazily on first use, so a
fresh database needs no migration step. Additive columns (`source_kind`,
`mime_type`, `start_index`) are added in place on first use. Mount a Railway
volume at `/data` and set `BOOKIFY_STORAGE_DIR=/data` so uploads survive
redeploys; the vector index no longer depends on it.

Documents indexed before 3.1 only exist as Chroma directories on the old
volume. Re-index them from the stored PDFs after deploying:

```bash
cd apps/backend
.venv/bin/python scripts/reindex_documents.py --dry-run   # list
.venv/bin/python scripts/reindex_documents.py             # re-index
```

Until object storage lands (see below), run a single backend replica: two
replicas would write uploads to two different disks behind one load balancer.
Indexing runs as an in-process background task, so the delete-during-index
tombstone and the stalled-document retry assume one backend replica as well.

`/health` is a liveness check; point Railway at `/health/ready` if you want
deploys to wait for the vector store (`select 1`) to answer.

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

### URL import

`POST /import/url` fetches a single page. The backend resolves DNS and rejects
private, loopback, link-local, and metadata addresses (each redirect hop is
re-checked), follows at most `BOOKIFY_URL_IMPORT_MAX_REDIRECTS`, and caps the
download at `BOOKIFY_URL_IMPORT_MAX_MB`. Only HTML and plain text are accepted;
the extracted text is stored as a `.txt` upload with `source_kind="url"` and
indexed like any other document. Railway therefore needs outbound HTTPS. Set
`BOOKIFY_URL_IMPORT=false` to disable the endpoint entirely.

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

The backend's own tables are not Drizzle-managed: `app/services/store.py`
creates `document_index`, `document_chunk`, the `vector` extension and its HNSW
index on first connection. The database user must be allowed to
`create extension vector` (the Neon owner is).

## Deploy checklist

1. Backend env set (including `DATABASE_URL`), volume mounted,
   `BOOKIFY_WARM_ON_STARTUP=false`.
2. Frontend env set, `BACKEND_API_SECRET` identical to the backend secret.
3. Migrations applied (frontend Drizzle; backend tables self-create).
4. `GET /health` returns 200 from the public backend URL.
5. Upload a document (`PDF`, `DOCX`, `TXT`, or `MD`) → status goes
   `queued → indexing → ready`.
6. Ask a question → tokens stream, citations resolve to pages (PDF) or chunks
   (text).
7. Import `https://example.com` from the sidebar → it becomes a text document;
   a private URL such as `http://127.0.0.1` is rejected.
8. `curl -H "X-Bookify-Secret: wrong" $BACKEND/documents/x` returns 401.
9. Redeploy the backend and confirm the document still opens (uploads volume +
   Neon index).
10. Run `scripts/reindex_documents.py` once for documents uploaded before 3.1.

## CI and evals

- `.github/workflows/ci.yml` runs on every push/PR: backend `ruff` + `pytest`,
  frontend `tsc` + `eslint` + `next build`. Everything is offline — no API keys
  needed.
- `.github/workflows/rag-eval.yml` is manual (`workflow_dispatch`) and needs a
  `MISTRAL_API_KEY` repository secret. See `apps/backend/RAG.md` for the golden
  set, thresholds, and the current known failure.

## Known deploy gaps (after Phase 3.1)

- Uploaded files still live on the volume; there is no object storage or
  signed-URL access. This is the remaining reason for a single replica.
- URL import fetches one page per request; there is no crawling, sitemap, or
  authenticated-page support.
- The embedding dimension is fixed at `RAG_EMBEDDING_DIM` (1024). Switching
  embedding models with a different size needs a schema change plus a reindex.
- Background indexing runs in-process (FastAPI `BackgroundTasks`), so a restart
  mid-index leaves a document stuck in `indexing`. Status polling surfaces this,
  but there is no automatic retry yet.
