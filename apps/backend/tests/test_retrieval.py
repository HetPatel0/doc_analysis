from __future__ import annotations

from app.schemas import ChatRequest
from app.services import retrieval as r
from langchain_core.documents import Document


def doc(text: str, page: int | None = None, chunk: int | None = None) -> Document:
    metadata = {}
    if page is not None:
        metadata["page_number"] = page
    if chunk is not None:
        metadata["chunk_index"] = chunk
    return Document(page_content=text, metadata=metadata)


def test_normalize_page_number_handles_pypdf_zero_index():
    assert r.normalize_page_number({"page": 0}) == 1
    assert r.normalize_page_number({"page": "3"}) == 4
    assert r.normalize_page_number({"page": "not-a-page"}) is None
    assert r.normalize_page_number({}) is None


def test_source_label_prefers_explicit_page_number():
    assert r.source_label({"page_number": 4, "chunk_index": 2}) == "p. 4, chunk 3"
    assert r.source_label({"page": 1}) == "p. 2"
    assert r.source_label({}) == "document"


def test_format_context_labels_blocks_and_dedupes_sources():
    context, sources = r.format_context(
        [doc("alpha", page=1, chunk=0), doc("beta", page=1, chunk=1)]
    )
    assert "[p. 1, chunk 1]\nalpha" in context
    assert sources == ["p. 1, chunk 1", "p. 1, chunk 2"]


def test_build_citations_dedupes_and_keeps_page_and_chunk():
    citations = r.build_citations(
        [
            doc("a", page=3, chunk=4),
            doc("b", page=3, chunk=4),
            doc("c", page=5, chunk=9),
        ]
    )
    assert citations == [
        {"label": "p. 3, chunk 5", "page": 3, "chunk": 5},
        {"label": "p. 5, chunk 10", "page": 5, "chunk": 10},
    ]


def test_format_history_keeps_only_recent_valid_turns():
    history = [{"role": "system", "content": "ignore me"}] + [
        {"role": "user", "content": f"question {i}"} for i in range(10)
    ]
    text = r.format_history(history)
    assert text.startswith("User: question 4")
    assert "question 3" not in text
    assert "ignore me" not in text


def test_format_history_empty():
    assert r.format_history([]) == "No previous conversation."


def test_build_retrieval_query_uses_recent_user_turns_only():
    request = ChatRequest(
        document_id="doc",
        message="and the price?",
        history=[
            {"role": "user", "content": "what is the starter plan"},
            {"role": "assistant", "content": "nine dollars"},
        ],
    )
    assert r.build_retrieval_query(request) == "what is the starter plan\nand the price?"


def test_rerank_prefers_lexical_matches_and_keeps_order_on_ties():
    docs = [
        doc("nothing relevant here", page=1),
        doc("the refund window is 14 days", page=2),
        doc("refund policy details", page=3),
    ]
    ranked = r.rerank_documents(docs, "refund window", limit=2)
    assert [d.metadata["page_number"] for d in ranked] == [2, 3]


def test_rerank_respects_limit():
    docs = [doc(f"chunk {i}", page=i + 1) for i in range(10)]
    assert len(r.rerank_documents(docs, "chunk", limit=3)) == 3


def test_source_footer_added_only_when_missing():
    assert r.with_source_footer("answer", ["p. 2"]).endswith("Sources: p. 2")
    assert r.with_source_footer("answer [p. 2]", ["p. 2"]) == "answer [p. 2]"
    assert (
        r.with_source_footer("I could not find the answer in the document.", ["p. 2"])
        == "I could not find the answer in the document."
    )
    assert r.with_source_footer("answer", []) == "answer"
