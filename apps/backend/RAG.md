# RAG quality: golden-set eval

The unit tests in `tests/` are offline and deterministic. Retrieval quality is
measured separately by `scripts/rag_eval.py`, which runs the real pipeline
(Mistral embeddings, pgvector, the configured chat model) against a fixed
document with known answers.

## Run it

From `apps/backend`, with `MISTRAL_API_KEY` and `DATABASE_URL` set:

```bash
# Retrieval only: no LLM answers, cheapest, fastest
.venv/bin/python scripts/rag_eval.py

# Full: retrieve + answer + citations + refusal check
.venv/bin/python scripts/rag_eval.py --mode full --json /tmp/rag-eval.json

# Regress-proof a change with stricter thresholds
.venv/bin/python scripts/rag_eval.py --mode full \
  --min-hit-rate 0.9 --min-keyword-recall 0.8 --max-unexpected-refusals 0
```

Exit codes: `0` thresholds met, `1` regression, `2` setup/API problem. Only the
golden PDF is indexed, into the pgvector store as document `rag-eval`; those
rows are deleted before and after the run, so your real documents are never
touched. `BOOKIFY_STORE=memory` runs the same eval without a database (it does
not exercise the SQL path).

Flags worth knowing:

| Flag | Meaning |
|---|---|
| `--mode retrieval\|full` | `full` costs ~9 LLM calls; `retrieval` is embeddings only |
| `--top-k N` | Override `RAG_RETRIEVAL_TOP_K` for the run |
| `--min-hit-rate` | Share of questions whose expected page must be cited |
| `--min-keyword-recall` | Share of expected keywords that must appear |
| `--max-unexpected-refusals` | Answerable questions the model may refuse (default 0) |
| `--temperature` | Eval temperature, default 0 for stable runs |
| `--json PATH` | Write per-question detail |

## Golden set

- `tests/fixtures/nimbus-notes.pdf` — 10-page synthetic product handbook.
  Regenerate with `.venv/bin/python scripts/make_golden_pdf.py`.
- `tests/fixtures/golden_qa.json` — 11 questions: 10 answerable (2 of them
  multi-turn with `history`) and 1 intentionally unanswerable to check refusals.

Each question is scored on:

1. **hit** — is the expected page among the retrieved citations?
2. **context keyword recall** — are the expected facts in the retrieved text?
3. **answer keyword recall** (`full`) — are the facts in the answer?
4. **refusal behaviour** (`full`) — unanswerable questions must produce the
   exact refusal sentence, answerable ones must not.

Keyword matching lowercases and collapses whitespace on both sides before
comparing. PDF text keeps hard line breaks (`"shared\nworkspaces"`), so the old
raw-substring matcher scored a correctly retrieved phrase as a miss.

Multi-turn entries carry a `history` list and go through the same
`ChatRequest` the app receives, so query rewriting is exercised for real. The
harness reports `rewrites_used` and a per-question `rewrite` column: `yes` means
the model rewrote the query, `no` means the deterministic query was used.

## Baseline (before Phase 3.3, 2026-10-31, `open-mistral-nemo`)

`--mode retrieval`: hit rate **1.00**, context recall **0.963** (10 chunks,
top-k 5).

`--mode full`: hit rate **1.00**, context recall **0.963**, answer recall
**0.875**, refusals **1/1**, one unexpected refusal.

One real failure the harness caught:

- `refunds` — *"How many days do I have to request a refund?"* → the model
  answered *"I could not find the answer in the document."* even though the
  correct chunk (`p. 3`: "Refunds are issued within 14 days of purchase") was
  the first context block and the page-3 citation was correct.
- The same context answered *"What is the refund window?"* correctly, so this
  was a generation-time paraphrase/refusal limitation of `open-mistral-nemo`,
  not retrieval.

## After Phase 3.3 (2026-10-31, `open-mistral-nemo`)

| Metric | Before | After |
|---|---:|---:|
| Retrieval hit rate | 1.000 | 1.000 |
| Context keyword recall | 0.963 | 0.963 |
| Answer keyword recall | 0.875 | **1.000** |
| Unexpected refusals (answerable) | 1 (`refunds`) | **0** |
| Expected refusals (unanswerable) | 1/1 | 1/1 |

Both modes exit `0` with the default thresholds. Reproduce with:

```bash
.venv/bin/python scripts/rag_eval.py --mode retrieval
.venv/bin/python scripts/rag_eval.py --mode full --json /tmp/rag-eval.json
```

### What changed

- **Generation-time refusal fix (the actual refunds fix).** The system prompt
  now says a fact may be paraphrased and asks the model to *silently identify
  the supporting sentence before answering*; it refuses only when no sentence
  supports an answer. This is deliberately a prompt change, not a retrieval
  change: the correct chunk was already first in the context. The earlier
  "context may phrase things differently" sentence alone did **not** fix it.
- **Query rewriting** (`app/services/query_rewrite.py`). Recent user turns plus
  the current question are rewritten into one standalone retrieval query with
  the chat model. The call is best-effort: errors, timeouts
  (`RAG_QUERY_REWRITE_TIMEOUT`, default 6 s) and empty output fall back to
  today's deterministic concatenation. `RAG_QUERY_REWRITE=false` disables it.
  The extra call is skipped when there is no useful history (no prior user turn
  with at least two content terms) **and** the question is concrete: at least
  two content terms, no follow-up prefix (`and`, `what about`, ...), and no
  pronoun in the first four tokens. That keeps single-turn eval and most
  production questions on the cheap path.
- **Hybrid retrieval** (`app/services/retrieval.py`). A pure similarity search
  fetches `max(2 × RAG_RETRIEVAL_FETCH_K, 20)` candidates. Duplicate chunks are
  removed by `document_id/page/chunk`, then BM25 scores the candidate pool.
  Dense and lexical rankings are fused with reciprocal rank fusion (RRF,
  `RAG_RETRIEVAL_RRF_K`, default 60) and the fused pool is reranked with
  normalised BM25, fused score, query-term coverage, phrase/proximity evidence
  and a small dense-rank prior before the final top-k. MMR was replaced because
  RRF needs a meaningful dense rank, and the lexical signal already supplies
  the diversity MMR was approximating.
- `RAG_RETRIEVAL_TOP_K`, `RAG_RETRIEVAL_FETCH_K`, source labels, citations and
  SSE event shapes are unchanged.

### Store (Phase 3.1)

Chunks and document status now live in Postgres instead of per-document Chroma
directories: `document_index` (status, chunk count, insights) and
`document_chunk` (`vector(1024)` embedding + HNSW cosine index), created lazily
by `app/services/store.py`. Retrieval is unchanged above the store — cosine
candidate pool, then BM25/RRF fusion and the multi-signal rerank.

The numbers below were reproduced on both the in-memory store and
`PostgresStore`; `--mode retrieval` and `--mode full` both exit `0` against
pgvector. Documents uploaded before 3.1 are re-indexed with
`scripts/reindex_documents.py`.

### Known measurement artifact (fixed 2026-11-01)

`team-plan` used to show context recall **0.667** even though the page-2 chunk
was retrieved and cited and the answer recall was **1.0**. The PDF line-wraps
"shared\nworkspaces", so the old raw-substring keyword matcher did not see the
phrase. The scorer now collapses whitespace before matching; the golden set was
left untouched.

## Harness fixes (2026-11-01, `open-mistral-nemo`)

| Metric | After 3.3 | After harness fix |
|---|---:|---:|
| Retrieval hit rate | 1.000 | 1.000 |
| Context keyword recall | 0.963 | **1.000** |
| Answer keyword recall | 1.000 | 1.000 |
| Unexpected refusals | 0 | 0 |
| Expected refusals | 1/1 | 1/1 |
| Questions / multi-turn | 9 / 0 | 11 / 2 |
| Rewrites actually used | 0 | 2 |

Changes:

- `keyword_recall` normalises whitespace and case on both the text and the
  expected keyword (`scripts/rag_eval.py`). This fixes the `team-plan` artifact
  above without editing the golden set.
- Golden-set entries may include `history`. The harness builds the same
  `ChatRequest` the API receives and formats that history into the answer
  prompt, so the query-rewrite path is covered end to end (2 new multi-turn
  cases: `team-plan-followup`, `api-limit-followup`).
- `chat_service.retrieve_with_query` returns the query that was searched;
  `retrieve` keeps its old signature. The harness records `rewrite_used` per
  question and `rewrites_used` in the summary, so a silent fallback to the
  deterministic query is visible instead of invisible.
- `tests/test_rag_eval.py` pins the normalisation, the request/history plumbing
  and the "multi-turn triggers rewrite, concrete single-turn does not" heuristic.

## What to measure next

- Add questions against a real-world PDF (scanned one too) before trusting the
  scores: the synthetic doc is intentionally clean.
- The two multi-turn cases prove the rewrite call runs and is scored, not that
  it beats the fallback: the synthetic document is lexically unambiguous, so
  the raw question often retrieves the right page anyway. A harder corpus is
  needed to measure rewrite *lift*.
- Keep the golden set small enough to run in under a minute; grow it with cases
  that have actually failed in production.
