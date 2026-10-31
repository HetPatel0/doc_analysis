# RAG quality: golden-set eval

The unit tests in `tests/` are offline and deterministic. Retrieval quality is
measured separately by `scripts/rag_eval.py`, which runs the real pipeline
(Mistral embeddings, Chroma, the configured chat model) against a fixed
document with known answers.

## Run it

From `apps/backend`, with `MISTRAL_API_KEY` set:

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
golden PDF is indexed, into a temporary directory — your real documents are
never touched.

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
- `tests/fixtures/golden_qa.json` — 9 questions: 8 answerable with an expected
  page and keywords, 1 intentionally unanswerable to check refusals.

Each question is scored on:

1. **hit** — is the expected page among the retrieved citations?
2. **context keyword recall** — are the expected facts in the retrieved text?
3. **answer keyword recall** (`full`) — are the facts in the answer?
4. **refusal behaviour** (`full`) — unanswerable questions must produce the
   exact refusal sentence, answerable ones must not.

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

### Known measurement artifact

`team-plan` still shows context recall **0.667** even though the page-2 chunk is
retrieved and cited and the answer recall is **1.0**. The PDF line-wraps
"shared\nworkspaces", so the keyword matcher does not see the exact string
"shared workspaces". This is a scorer/PDF-layout artifact, not a retrieval
regression; the golden set was left untouched.

## What to measure next

- Add questions against a real-world PDF (scanned one too) before trusting the
  scores: the synthetic doc is intentionally clean.
- Add a multi-turn case so query rewriting is scored directly; the current
  golden set is single-turn and therefore exercises the rewrite *fallback/skip*
  path, not the rewrite itself.
- Keep the golden set small enough to run in under a minute; grow it with cases
  that have actually failed in production.
