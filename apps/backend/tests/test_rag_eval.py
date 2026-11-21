"""Offline tests for the eval harness itself.

The harness is only useful if its scorer and request shaping are trustworthy:
these tests pin the whitespace normalisation that PDF line-wraps used to break
and the multi-turn plumbing that makes the rewrite path observable.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from langchain_core.documents import Document

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT / "scripts"))

from app.services import retrieval  # noqa: E402

import rag_eval  # noqa: E402

GOLDEN_QA = BACKEND_ROOT / "tests" / "fixtures" / "golden_qa.json"
REALWORLD_DATASET = (
    BACKEND_ROOT / "tests" / "fixtures" / "realworld" / "dataset.json"
)


def golden_items() -> list[dict]:
    return json.loads(GOLDEN_QA.read_text(encoding="utf-8"))["questions"]


def test_normalize_for_match_collapses_pdf_line_wraps():
    assert (
        rag_eval.normalize_for_match("adds shared\nworkspaces,\tversion  history")
        == "adds shared workspaces, version history"
    )


def test_keyword_recall_matches_phrase_split_across_lines():
    context = "The Team plan costs 29 USD and adds shared\nworkspaces, version history."

    assert rag_eval.keyword_recall(context, ["shared workspaces", "version history"]) == 1.0


def test_keyword_recall_still_reports_partial_and_empty_cases():
    assert rag_eval.keyword_recall("only AES-256 here", ["AES-256", "TLS 1.3"]) == 0.5
    assert rag_eval.keyword_recall("anything", []) == 1.0


def test_build_chat_request_carries_history_and_defaults_to_single_turn():
    item = golden_items()[0]
    multi = rag_eval.build_chat_request(
        item | {"history": [{"role": "user", "content": "hi"}]}
    )
    single = rag_eval.build_chat_request(item)

    assert multi.document_id == "rag-eval"
    assert multi.history == [{"role": "user", "content": "hi"}]
    assert single.history == []


def test_multi_turn_golden_entries_exercise_query_rewriting():
    multi_turn = [item for item in golden_items() if item.get("history")]

    assert multi_turn, "golden set should cover the multi-turn rewrite path"
    for item in multi_turn:
        request = rag_eval.build_chat_request(item)
        assert retrieval.should_rewrite_query(request) is True


def test_concrete_single_turn_question_skips_the_rewrite_call():
    item = next(item for item in golden_items() if item["id"] == "support-hours")
    request = rag_eval.build_chat_request(item)

    assert retrieval.should_rewrite_query(request) is False


def test_score_question_supports_chunk_citations_for_text_formats():
    item = {
        "id": "stipend",
        "question": "How large is the stipend?",
        "expected_chunk": 2,
        "expected_keywords": ["750 USD"],
    }
    docs = [Document(page_content="The stipend is 750 USD.")]
    citations = [{"label": "chunk 2", "page": None, "chunk": 2}]

    row = rag_eval.score_question(item, docs, citations, None)

    assert row["hit"] is True
    assert row["expected_chunk"] == 2
    assert row["retrieved_chunks"] == [2]
    assert row["expected_refusal"] is False


def test_score_question_misses_a_wrong_chunk_and_keeps_pages_unscored():
    item = {"id": "x", "question": "q", "expected_chunk": 2}
    citations = [{"label": "chunk 1", "page": None, "chunk": 1}]

    row = rag_eval.score_question(item, [], citations, None)

    assert row["hit"] is False


def test_unanswerable_entries_are_classified_by_refusal_flag_not_page():
    item = {
        "id": "unanswerable",
        "question": "What is the CEO salary?",
        "expected_refusal": True,
    }

    row = rag_eval.score_question(item, [], [], None)

    assert row["expected_refusal"] is True
    assert row["hit"] is None


def test_realworld_manifest_resolves_every_document_and_qa_file():
    args = argparse.Namespace(
        dataset=REALWORLD_DATASET,
        pdf=rag_eval.DEFAULT_PDF,
        document=None,
        qa=GOLDEN_QA,
        source_kind=None,
    )

    cases = rag_eval.load_cases(args)

    assert [case["name"] for case in cases] == [
        "scan-refunds",
        "messy-report",
        "policy-docx",
        "pricing-url",
    ]
    assert [case["source_kind"] for case in cases] == ["pdf", "pdf", "docx", "url"]
    for case in cases:
        assert case["path"].is_file()
        assert case["qa"]["questions"], case["name"]

