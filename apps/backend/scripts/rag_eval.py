"""RAG regression eval against a golden or real-world corpus.

Two modes:

    retrieval-only (default)  scores what the retriever puts in the prompt.
    full                     also asks the LLM and scores the answer/citations.

A run covers either one document (``--pdf``/``--document`` + ``--qa``) or a
manifest of documents (``--dataset``). The real-world corpus lives in
``tests/fixtures/realworld/dataset.json`` and covers an OCR scan, a messy
multi-column PDF, a DOCX table, and URL text.

Requires a real MISTRAL_API_KEY (embeddings; answers in `full` mode). Everything
is indexed into a throwaway temp directory, so your real documents and
vectorstores are never touched.

Usage, from `apps/backend`:

    .venv/bin/python scripts/rag_eval.py
    .venv/bin/python scripts/rag_eval.py --dataset tests/fixtures/realworld/dataset.json
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
REALWORLD_DATASET = BACKEND_ROOT / "tests" / "fixtures" / "realworld" / "dataset.json"
REFUSAL_MARKER = "i could not find the answer in the document"

_SOURCE_KINDS = ("pdf", "docx", "txt", "md", "url")
_KIND_BY_SUFFIX = {
    ".pdf": "pdf",
    ".docx": "docx",
    ".txt": "txt",
    ".md": "md",
    ".markdown": "md",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Bookify RAG eval")
    parser.add_argument(
        "--pdf",
        type=Path,
        default=DEFAULT_PDF,
        help="single PDF to evaluate (kept for backwards compatibility)",
    )
    parser.add_argument(
        "--document",
        type=Path,
        default=None,
        help="single document to evaluate; overrides --pdf",
    )
    parser.add_argument(
        "--source-kind",
        choices=_SOURCE_KINDS,
        default=None,
        help="source kind for --document (inferred from the extension by default)",
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        default=None,
        help="JSON manifest of documents; overrides --pdf/--document",
    )
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


def infer_source_kind(path: Path) -> str:
    return _KIND_BY_SUFFIX.get(path.suffix.lower(), "pdf")


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_cases(args: argparse.Namespace) -> list[dict[str, Any]]:
    """Resolve the CLI into a list of ``{name, path, source_kind, qa}`` cases."""
    if args.dataset:
        manifest_path = args.dataset.resolve()
        if not manifest_path.exists():
            raise SystemExit(f"dataset manifest not found: {manifest_path}")
        manifest = _read_json(manifest_path)
        base = manifest_path.parent
        cases: list[dict[str, Any]] = []
        for entry in manifest.get("documents", []):
            path = (base / entry["path"]).resolve()
            if not path.exists():
                raise SystemExit(f"fixture not found: {path}")
            qa_path = entry.get("qa")
            if qa_path:
                qa = _read_json((base / qa_path).resolve())
            else:
                qa = {"questions": entry.get("questions", [])}
            cases.append(
                {
                    "name": entry.get("name", path.stem),
                    "path": path,
                    "source_kind": entry.get("source_kind")
                    or infer_source_kind(path),
                    "qa": qa,
                }
            )
        if not cases:
            raise SystemExit(f"dataset manifest has no documents: {manifest_path}")
        return cases

    document = (args.document or args.pdf).resolve()
    if not document.exists():
        raise SystemExit(f"document not found: {document}")
    qa = _read_json(args.qa)
    return [
        {
            "name": qa.get("name", document.stem),
            "path": document,
            "source_kind": args.source_kind or infer_source_kind(document),
            "qa": qa,
        }
    ]


def setup_case(case: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    """Index one document as ``rag-eval`` and return its run metadata."""
    from app.config import settings
    from app.services import documents
    from app.services.store import get_store

    source = case["path"]
    get_store().delete_document("rag-eval")

    upload_path = settings.uploads_dir / f"eval-{source.name}"
    upload_path.write_bytes(source.read_bytes())

    started = time.perf_counter()
    documents.index_document(
        "rag-eval", source.name, upload_path, case["source_kind"]
    )
    index_seconds = round(time.perf_counter() - started, 2)

    status = documents.read_document_status("rag-eval")
    if status.status != "ready":
        raise SystemExit(
            f"indexing failed for {source.name} ({status.status}): {status.error}\n"
            "Check MISTRAL_API_KEY, DATABASE_URL and the document fixture."
        )

    return {
        "artifact": source.name,
        "source_kind": case["source_kind"],
        "mode": args.mode,
        "store": type(get_store()).__name__,
        "chunks": status.chunks_indexed,
        "chunk_strategy": settings.chunk_strategy,
        "chunk_size": settings.chunk_size,
        "chunk_overlap": settings.chunk_overlap,
        "ocr_used": status.ocr_used,
        "ocr_provider": status.ocr_provider,
        "index_seconds": index_seconds,
        "top_k": settings.retrieval_top_k,
    }


def score_question(
    item: dict[str, Any],
    docs: list[Any],
    citations: list[dict[str, Any]],
    answer: str | None,
) -> dict[str, Any]:
    context = "\n".join(doc.page_content for doc in docs)
    pages = [citation["page"] for citation in citations if citation.get("page")]
    chunks = [citation["chunk"] for citation in citations if citation.get("chunk")]
    expected_page = item.get("expected_page")
    expected_chunk = item.get("expected_chunk")

    if expected_page is not None:
        hit: bool | None = expected_page in pages
    elif expected_chunk is not None:
        hit = expected_chunk in chunks
    else:
        hit = None

    row: dict[str, Any] = {
        "id": item["id"],
        "question": item["question"],
        "expected_page": expected_page,
        "expected_chunk": expected_chunk,
        "expected_refusal": bool(item.get("expected_refusal")),
        "retrieved_pages": pages,
        "retrieved_chunks": chunks,
        "hit": hit,
        "context_keyword_recall": round(
            keyword_recall(context, item.get("expected_keywords", [])), 3
        ),
    }

    if answer is not None:
        answered = answer.strip()
        refused = REFUSAL_MARKER in answered.lower()
        row["refused"] = refused
        if item.get("expected_refusal"):
            row["answer_keyword_recall"] = None
        else:
            # A refusal on an answerable question is a miss, not a valid answer.
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
        ) + sum(1 for chunk in chunks if f"chunk {chunk}" in answered.lower())
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


def run_case(
    case: dict[str, Any], args: argparse.Namespace, llm: Any
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    from app import dependencies as deps
    from app.services import chat as chat_service
    from app.services import retrieval

    meta = setup_case(case, args)
    rows: list[dict[str, Any]] = []

    for item in case["qa"].get("questions", []):
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
        row["document"] = case["name"]
        row["turns"] = len(request.history) + 1
        row["retrieval_query"] = retrieval_query
        row["rewrite_used"] = retrieval_query != retrieval.build_retrieval_query(
            request
        )
        rows.append(row)
        if args.verbose:
            print(f"  {case['name']}/{row['id']}: {row}")

    return rows, meta


def summarize_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    hits = [row["hit"] for row in rows if row["hit"] is not None]
    hit_rate = sum(hits) / len(hits) if hits else 1.0
    recall = (
        sum(row["context_keyword_recall"] for row in rows) / len(rows) if rows else 0.0
    )

    summary: dict[str, Any] = {
        "questions": len(rows),
        "multi_turn_questions": sum(1 for row in rows if row["turns"] > 1),
        "rewrites_used": sum(1 for row in rows if row["rewrite_used"]),
        "hit_rate": round(hit_rate, 3),
        "context_keyword_recall": round(recall, 3),
    }

    if any("refused" in row for row in rows):
        answerable = [row for row in rows if not row.get("expected_refusal")]
        unanswerable = [row for row in rows if row.get("expected_refusal")]
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

    return summary


def run(args: argparse.Namespace) -> int:
    from app.config import settings
    from app.services import insights
    from langchain_mistralai import ChatMistralAI

    cases = load_cases(args)

    if args.top_k is not None:
        settings.retrieval_top_k = args.top_k

    if args.mode == "retrieval":
        # Skip the insights LLM call: it costs tokens and is not being scored.
        insights.generate_insights = lambda chunks: dict(insights.EMPTY_INSIGHTS)

    llm = ChatMistralAI(
        model_name=settings.mistral_model, temperature=args.temperature
    )
    all_rows: list[dict[str, Any]] = []
    case_reports: list[dict[str, Any]] = []

    for case in cases:
        rows, meta = run_case(case, args, llm)
        report = {**meta, **summarize_rows(rows)}
        case_reports.append(report)
        all_rows.extend(rows)

        width = max(len(row["id"]) for row in rows) + 2
        print(f"\n== {case['name']} ({case['source_kind']}) ==")
        print(
            f"{'question':<{width}} {'page':>5} {'chunk':>5} {'hit':>5} "
            f"{'ctx recall':>10} {'rewrite':>8}"
        )
        for row in rows:
            hit = "-" if row["hit"] is None else ("yes" if row["hit"] else "NO")
            print(
                f"{row['id']:<{width}} {row['expected_page']!s:>5} "
                f"{row['expected_chunk']!s:>5} {hit:>5} "
                f"{row['context_keyword_recall']:>10.2f} "
                f"{('yes' if row['rewrite_used'] else 'no'):>8}"
            )
            if args.mode == "full" and row.get("answer") is not None:
                print(f"    answer: {row['answer'][:160].replace(chr(10), ' ')}")
            if args.verbose and row["rewrite_used"]:
                print(f"    query: {row['retrieval_query']}")

    overall = summarize_rows(all_rows)
    summary = {
        "dataset": args.dataset.name if args.dataset else "single",
        "mode": args.mode,
        "store": case_reports[0]["store"] if case_reports else "unknown",
        "documents": len(case_reports),
        "ocr_used_documents": sum(1 for report in case_reports if report["ocr_used"]),
        "chunk_strategy": settings.chunk_strategy,
        "chunk_size": settings.chunk_size,
        "chunk_overlap": settings.chunk_overlap,
        "top_k": settings.retrieval_top_k,
        **overall,
        "min_hit_rate": args.min_hit_rate,
        "min_keyword_recall": args.min_keyword_recall,
    }

    failed = (
        overall["hit_rate"] < args.min_hit_rate
        or overall["context_keyword_recall"] < args.min_keyword_recall
    )
    if args.mode == "full":
        failed = failed or (
            overall["answer_keyword_recall"] < args.min_keyword_recall
        )
        failed = failed or (
            overall["refusals_passed"] != overall["refusals_total"]
        )
        failed = failed or (
            len(overall["unexpected_refusals"]) > args.max_unexpected_refusals
        )
    summary["passed"] = not failed

    print("\nper-document:")
    for report in case_reports:
        print(
            f"  {report['artifact']:<20} {report['source_kind']:<5} "
            f"chunks={report['chunks']!s:<4} ocr={report['ocr_used']!s:<5} "
            f"hit={report['hit_rate']:.3f} ctx={report['context_keyword_recall']:.3f}"
        )

    print("\nsummary:")
    for key, value in summary.items():
        print(f"  {key}: {value}")

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(
            json.dumps(
                {"summary": summary, "cases": case_reports, "results": all_rows},
                indent=2,
            ),
            encoding="utf-8",
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
        finally:
            try:
                from app.services.store import get_store

                get_store().delete_document("rag-eval")
            except Exception:  # no DB configured: nothing to clean up
                pass


if __name__ == "__main__":
    sys.exit(main())
