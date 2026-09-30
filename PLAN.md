# Bookify — Upgrade & Feature Plan

> Ordered by impact / risk. Do Phase 0-1 first, Phase 2-3 next, Phase 4 later.
> Stack: `apps/frontend` (Next.js 16 + Better-Auth + Drizzle + Neon) + `apps/backend` (FastAPI + LangChain + Chroma + Mistral).

## Current pain points (why this order)

1. Backend is open + stateful on local disk — will break/leak on Railway.
2. Chat is blocking (no streaming), no history persistence, single-doc only.
3. `pdf-chat-shell.tsx` (~780 lines) owns everything — hard to extend.
4. RAG is baseline: PyPDF-only, no OCR, no hybrid search, no evals.

---

## Phase 0 — Prod hardening (DO FIRST, ~2-3 days)

Highest risk if skipped. No user-visible features, unblocks everything else.

| # | Task | Why first | Touches |
|---|------|-----------|---------|
| 0.1 | Replace `@app.on_event("startup")` with `lifespan` in `apps/backend/main.py:273` | Deprecated, will break on FastAPI upgrade | `main.py` |
| 0.2 | FE→BE auth: `BOOKIFY_API_SECRET` header checked on `/upload`, `/chat`, `/documents/*` | Anyone can call Railway URL directly today | `main.py`, `lib/server/workspace.ts`, Railway+Vercel env |
| 0.3 | Upload guards: 20MB max, `content-type` + magic-byte check, filename sanitize | OOM / disk-fill vector | `main.py:355` |
| 0.4 | `DELETE /documents/{id}` + delete Chroma dir + upload file + DB row | Storage grows forever on volume | `main.py`, `app/api/documents/[documentId]/route.ts`, `lib/server/workspace.ts` |
| 0.5 | Pin `requirements.txt`, remove unused `pandas/streamlit/openai/langchain-openai`, add `ruff` + `pytest` | Non-reproducible deploys | `requirements.txt` |
| 0.6 | Split `pdf-chat-shell.tsx`: `hooks/useWorkspace.ts`, `hooks/useChat.ts`, `components/auth-form.tsx` | Every later feature touches this file | `components/` |

Exit criteria: secret-protected BE, size-limited uploads, deletable docs, reproducible builds.

## Phase 1 — Core chat UX (DO SECOND, ~1 week)

Biggest perceived quality jump for least effort.

| # | Task | Why | Touches |
|---|------|-----|---------|
| 1.1 | Streaming chat: BE `StreamingResponse` (SSE) + FE reader | Blocking chat feels slow; streaming = 3x perceived speed | `main.py:/chat`, `app/api/documents/chat/route.ts`, `pdf-chat-shell` |
| 1.2 | Markdown answers: `react-markdown` + code blocks + copy button + retry/stop | Answers are plain text today | `components/chat-message.tsx` (new) |
| 1.3 | Persist messages: new `message` table (`document_id, role, content, created_at`), load on refresh | Refresh wipes conversation today | `lib/db/schema/app.ts`, `drizzle/`, `lib/server/workspace.ts` |
| 1.4 | Upload UX: drag-drop, progress bar, client-side PDF + size check | Poll loop (1s x 120) with no feedback | `components/pdf-dropzone.tsx` |
| 1.5 | Error states + Sentry (FE + BE) | `backend unreachable` gives no retry path | `sentry.*`, routes |

Exit criteria: token streaming, refresh-safe history, markdown with citations.

## Phase 2 — Multi-doc workspace (THIRD, ~1-2 weeks)

Removes the "one PDF at a time" ceiling.

| # | Task | Why later | Touches |
|---|------|-----------|---------|
| 2.1 | Document library sidebar: list all docs per owner, switch active, delete | Schema already has `documents` table; only `findLatestDocument` blocks this | `lib/server/workspace.ts:98`, `app/api/workspace/route.ts`, new `components/doc-sidebar.tsx` |
| 2.2 | Per-document chat history + `chatsUsed` already exists | Depends on 1.3 | `message` table |
| 2.3 | Side-by-side PDF viewer (`react-pdf`) + click citation → jump to page | Citations are `p. X` strings today, not actionable | `components/pdf-viewer.tsx`, `format_context` in `main.py:198` |
| 2.4 | Auto-summary / action-items / quiz on upload complete | High demo value, cheap (one extra LLM call) | `main.py`, chat route |

## Phase 3 — RAG quality + scale (FOURTH, ~2 weeks)

Do after UX, because better retrieval is invisible if chat UX is poor.

| # | Task | Why later | Touches |
|---|------|-----------|---------|
| 3.1 | Migrate Chroma FS → `pgvector` on Neon | Railway volume + per-doc Chroma dirs won't scale; you already pay for Neon | `main.py`, `requirements.txt`, `drizzle/` |
| 3.2 | OCR fallback: scanned PDF → `unstructured` / Mistral OCR when `loader.load()` is empty | `PyPDFLoader` returns nothing on scans → `failed` today | `index_pdf` in `main.py:284` |
| 3.3 | Hybrid retrieval: BM25 + vector + rerank, query-rewrite with history | Current `rerank_documents` is naive term-count | `main.py:237` |
| 3.4 | Chunking experiments: semantic splitter option, expose `RAG_*` in Railway env | Hardcoded `900/120` | `main.py:31` |
| 3.5 | Evals: golden PDF + Q/A set, `pytest` RAG regression | Prevents silent quality drops | `apps/backend/tests/` (new) |
| 3.6 | Support DOCX/TXT/MD + URL import | PDF-only limits adoption | `document_loaders/` |

## Phase 4 — Growth / monetization (LAST)

| # | Task | Depends on |
|---|------|------------|
| 4.1 | Stripe: Pro tier (unlimited docs/chats), usage gating via existing `usage_subject` table | Phases 0-2 |
| 4.2 | Shareable public chat links + export to MD/PDF | 1.3, 2.2 |
| 4.3 | Team workspaces, API keys | 2.1, 0.2 |
| 4.4 | Analytics (PostHog), guest→user conversion funnel, PWA/mobile polish | 1.x |

---

## Recommended build order (TL;DR)

```
Week 1:  0.1 → 0.2 → 0.3 → 0.4 → 0.5
Week 2:  1.1 → 1.2 → 1.3
Week 3:  1.4 → 1.5 → 0.6 (refactor while adding sidebar)
Week 4+: 2.1 → 2.2 → 2.3 → 2.4
Later:   3.1 → 3.2 → 3.3 → 4.1
```

## What NOT to do yet

* Don't add more LLM providers — Mistral-only keeps evals simple.
* Don't add i18n / theming system — single theme toggle is enough until retention.
* Don't self-host embeddings — Mistral embeddings + pgvector is enough scale for now.
