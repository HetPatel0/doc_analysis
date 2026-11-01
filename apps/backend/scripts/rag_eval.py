"""RAG regression eval against a golden document.

Two modes:

    retrieval-only (default)  scores what the retriever puts in the prompt.
    full                     also asks the LLM and scores the answer/citations.

Requires a real MISTRAL_API_KEY (embeddings; answers in `full` mode). Everything
is indexed into a throwaway temp directory, so your real documents and
vectorstores are never touched.

Usage, from `apps/backend`:

    .venv/bin/python scripts/rag_eval.py
    .venv/bin/python scripts/rag_eval.py --mode full --json /tmp/rag-eval.json

Exit codes: 0 = thresholds met, 1 = regression, 2 = setup/API problem.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

DEFAULT_PDF = BACKEND_ROOT / "tests" / "fixtures" / "nimbus-notes.pdf"
DEFAULT_QA = BACKEND_ROOT / "tests" / "fixtures" / "golden_qa.json"
REFUSAL_MARKER = "i could not find the answer in the document"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Bookify RAG eval")
    parser.add_argument("--pdf", type=Path, default=DEFAULT_PDF)
    parser.add_argument("--qa", type=Path, default=DEFAULT_QA)
    parser.add_argument("--mode", choices=["retrieval", "full"], default="retrieval")
    parser.add_argument("--top-k", type=int, default=None, help="override RAG_RETRIEVAL_TOP_K")
    parser.add_argument("--json", type=Path, default=None, help="write the full report here")
    parser.add_argument("--min-hit-rate", type=float, default=0.8)
    parser.add_argument("--min-keyword-recall", type=float, default=0.6)
    parser.add_argument(
        "--max-unexpected-refusals",
        type=int,
        default=0,
        help="answerable questions the model may refuse (0 = never)",
    )
    parser.add_argument(
        "--temperature",
        type=float,
        default=0.0,
        help="LLM temperature for eval runs (production keeps the SDK default)",
    )
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args()


def normalize_for_match(text: str) -> str:
    """Lowercase and collapse whitespace so PDF line-wraps do not hide a phrase.

    `pypdf` keeps hard line breaks, so a phrase like "shared workspaces" arrives
    as "shared\\nworkspaces". Matching on the raw string scored that chunk as a
    miss even though the text was retrieved and cited.
    """
    return " ".join(text.lower().split())


def keyword_recall(text: str, keywords: list[str]) -> float:
    if not keywords:
        return 1.0
    haystack = normalize_for_match(text)
    hits = sum(1 for keyword in keywords if normalize_for_match(keyword) in haystack)
    return hits / len(keywords)


def setup(args: argparse.Namespace) -> tuple[Any, dict[str, Any]]:
    """Index the golden PDF into a temp storage dir and load the QA set."""
    from app.config import settings
    from app.services import documents, insights

    if args.top_k is not None:
        settings.retrieval_top_k = args.top_k

    qa = json.loads(args.qa.read_text(encoding="utf-8"))
    pdf_bytes = args.pdf.read_bytes()

    if args.mode == "retrieval":
        # Skip the insights LLM call: it costs tokens and is not being scored.
        insights.generate_insights = lambda chunks: dict(insights.EMPTY_INSIGHTS)

    upload_path = settings.uploads_dir / f"eval-{args.pdf.name}"
    upload_path.write_bytes(pdf_bytes)

    started = time.perf_counter()
    documents.index_pdf("rag-eval", args.pdf.name, upload_path)
    index_seconds = round(time.perf_counter() - started, 2)

    status = documents.read_document_status("rag-eval")
    if status.status != "ready":
        raise SystemExit(
            f"indexing failed ({status.status}): {status.error}\n"
            "Check MISTRAL_API_KEY and the PDF fixture."
        )

    meta = {
        "artifact": args.pdf.name,
        "mode": args.mode,
        "chunks": status.chunks_indexed,
        "ocr_used": status.ocr_used,
        "index_seconds": index_seconds,
        "top_k": settings.retrieval_top_k,
    }
    return qa, meta


def score_question(
    item: dict[str, Any],
    docs: list[Any],
    citations: list[dict[str, Any]],
    answer: str | None,
) -> dict[str, Any]:
    context = "\n".join(doc.page_content for doc in docs)
    pages = [citation["page"] for citation in citations if citation["page"]]
    expected_page = item.get("expected_page")

    row: dict[str, Any] = {
        "id": item["id"],
        "question": item["question"],
        "expected_page": expected_page,
        "retrieved_pages": pages,
        "hit": None if expected_page is None else expected_page in pages,
        "context_keyword_recall": round(
            keyword_recall(context, item.get("expected_keywords", [])), 3
        ),
    }

    if answer is not None:
        answered = answer.strip()
        refused = REFUSAL_MARKER in answered.lower()
        if item.get("expected_refusal"):
            row["refused"] = refused
            row["answer_keyword_recall"] = None
        else:
            # A refusal on an answerable question is a miss, not a valid answer.
            row["refused"] = refused
            row["answer_keyword_recall"] = (
                0.0
                if refused
                else round(
                    keyword_recall(answered, item.get("expected_keywords", [])), 3
                )
            )
        row["answer"] = answered
        row["citations_in_answer"] = sum(
            1 for page in pages if f"p. {page}" in answered.lower()
        )
    return row


def build_chat_request(item: dict[str, Any]):
    """Turn one golden-set entry into the request the app would receive.

    An entry may carry `history` (previous user/assistant turns) so multi-turn
    query rewriting is exercised instead of only its single-turn skip path.
    """
    from app.schemas import ChatRequest

    return ChatRequest(
        document_id="rag-eval",
        message=item["question"],
        history=item.get("history", []),
    )


def run(args: argparse.Namespace) -> int:
    from app import dependencies as deps
    from app.config import settings
    from app.services import chat as chat_service
    from app.services import retrieval
    from langchain_mistralai import ChatMistralAI

    qa, meta = setup(args)
    questions = qa["questions"]
    llm = ChatMistralAI(
        model_name=settings.mistral_model, temperature=args.temperature
    )
    rows: list[dict[str, Any]] = []

    for item in questions:
        request = build_chat_request(item)
        docs, citations, retrieval_query = chat_service.retrieve_with_query(request)

        answer = None
        if args.mode == "full":
            context, _ = retrieval.format_context(docs)
            prompt = deps.get_prompt().invoke(
                {
                    "context": context,
                    "history": retrieval.format_history(request.history),
                    "question": request.message,
                }
            )
            answer = llm.invoke(prompt).content

        row = score_question(item, docs, citations, answer)
        row["turns"] = len(request.history) + 1
        row["retrieval_query"] = retrieval_query
        row["rewrite_used"] = retrieval_query != retrieval.build_retrieval_query(request)
        rows.append(row)
        if args.verbose:
            print(f"  {row['id']}: {row}")

    hits = [row["hit"] for row in rows if row["hit"] is not None]
    hit_rate = sum(hits) / len(hits) if hits else 1.0
    recall = sum(row["context_keyword_recall"] for row in rows) / len(rows)

    summary = {
        **meta,
        "questions": len(rows),
        "multi_turn_questions": sum(1 for row in rows if row["turns"] > 1),
        "rewrites_used": sum(1 for row in rows if row["rewrite_used"]),
        "hit_rate": round(hit_rate, 3),
        "context_keyword_recall": round(recall, 3),
        "min_hit_rate": args.min_hit_rate,
        "min_keyword_recall": args.min_keyword_recall,
    }

    failed = False
    if args.mode == "full":
        answerable = [row for row in rows if row["expected_page"] is not None]
        unanswerable = [row for row in rows if row["expected_page"] is None]
        summary["answer_keyword_recall"] = round(
            sum(row["answer_keyword_recall"] for row in answerable) / len(answerable)
            if answerable
            else 0.0,
            3,
        )
        summary["unexpected_refusals"] = [
            row["id"] for row in answerable if row["refused"]
        ]
        summary["refusals_passed"] = sum(1 for row in unanswerable if row["refused"])
        summary["refusals_total"] = len(unanswerable)
        failed = failed or summary["answer_keyword_recall"] < args.min_keyword_recall
        failed = failed or summary["refusals_passed"] != summary["refusals_total"]
        failed = failed or (
            len(summary["unexpected_refusals"]) > args.max_unexpected_refusals
        )

    failed = failed or hit_rate < args.min_hit_rate or recall < args.min_keyword_recall
    summary["passed"] = not failed

    width = max(len(row["id"]) for row in rows) + 2
    print(
        f"\n{'question':<{width}} {'page':>5} {'hit':>5} "
        f"{'ctx recall':>10} {'rewrite':>8}"
    )
    for row in rows:
        hit = "-" if row["hit"] is None else ("yes" if row["hit"] else "NO")
        print(
            f"{row['id']:<{width}} {row['expected_page']!s:>5} {hit:>5} "
            f"{row['context_keyword_recall']:>10.2f} "
            f"{('yes' if row['rewrite_used'] else 'no'):>8}"
        )
        if args.mode == "full" and row.get("answer") is not None:
            print(f"    answer: {row['answer'][:160].replace(chr(10), ' ')}")
        if args.verbose and row["rewrite_used"]:
            print(f"    query: {row['retrieval_query']}")

    print("\nsummary:")
    for key, value in summary.items():
        print(f"  {key}: {value}")

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(
            json.dumps({"summary": summary, "results": rows}, indent=2), encoding="utf-8"
        )
        print(f"  report: {args.json}")

    return 0 if not failed else 1


def main() -> int:
    args = parse_args()

    from dotenv import dotenv_values

    # Read .env without importing app.config yet (storage must be redirected first).
    for key, value in dotenv_values(BACKEND_ROOT / ".env").items():
        if value is not None and not os.getenv(key):
            os.environ[key] = value

    # Point storage at a temp dir before app modules read the setting.
    with tempfile.TemporaryDirectory(prefix="bookify-rag-eval-") as storage:
        os.environ["BOOKIFY_STORAGE_DIR"] = storage
        if not os.getenv("MISTRAL_API_KEY"):
            print("MISTRAL_API_KEY is not set; embeddings are required.", file=sys.stderr)
            return 2
        try:
            return run(args)
        except SystemExit as exc:
            print(str(exc), file=sys.stderr)
            return 2
        except Exception as exc:  # network/quota/API problems
            print(f"eval failed: {exc}", file=sys.stderr)
            return 2


if __name__ == "__main__":
    sys.exit(main())
