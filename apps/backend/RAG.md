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

## Baseline (2026-10-31, `open-mistral-nemo`)

`--mode retrieval`: hit rate **1.00**, context recall **0.96** (10 chunks, top-k 5).
`--mode full`: hit rate **1.00**, answer recall **0.875**, refusals **1/1**.

One real failure the harness caught:

- `refunds` — *"How many days do I have to request a refund?"* → the model
  answers *"I could not find the answer in the document."* even though the
  correct chunk (`p. 3`: "Refunds are issued within 14 days of purchase") is the
  first context block and the page-3 citation is correct.
- The same context answers *"What is the refund window?"* correctly. So this is
  a wording/paraphrase limitation of `open-mistral-nemo`, not retrieval and not
  prompt-copying; adding "answer if the context states it differently" to the
  system prompt did not fix it.

Because `--max-unexpected-refusals` defaults to `0`, the full eval currently
exits `1`. That is intentional: it is the baseline Phase 3.3 (query rewriting /
model choice) has to beat. Until then, use
`--max-unexpected-refusals 1` to track changes without failing on this known
issue.

## What to measure next

- After 3.3 (query rewrite + hybrid retrieval), `answer_keyword_recall` and
  `unexpected_refusals` are the two numbers that matter.
- Add questions against a real-world PDF (scanned one too) before trusting the
  scores: the synthetic doc is intentionally clean.
- Keep the golden set small enough to run in under a minute; grow it with cases
  that have actually failed in production.
