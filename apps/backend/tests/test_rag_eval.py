"""Offline tests for the eval harness itself.

The harness is only useful if its scorer and request shaping are trustworthy:
these tests pin the whitespace normalisation that PDF line-wraps used to break
and the multi-turn plumbing that makes the rewrite path observable.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT / "scripts"))

from app.services import retrieval  # noqa: E402

import rag_eval  # noqa: E402

GOLDEN_QA = BACKEND_ROOT / "tests" / "fixtures" / "golden_qa.json"


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
