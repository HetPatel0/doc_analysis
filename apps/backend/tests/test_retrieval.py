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


def test_tokenize_stems_and_drops_stopwords():
    # "how" and "were" are stopwords; plurals/past tense are stemmed.
    assert r.tokenize("How many refunds were requested?") == [
        "many",
        "refund",
        "request",
    ]
    assert "the" not in r.tokenize("the notes")
    assert r.tokenize("notes") == ["note"]


def test_bm25_rewards_rarer_terms_and_saturates_frequency():
    corpus = [
        r.tokenize("refund refund refund refund"),
        r.tokenize("refund policy covers the purchase window"),
        r.tokenize("unrelated support hours"),
    ]
    scores = r.BM25(corpus).scores(r.tokenize("refund policy"))
    assert scores[1] > scores[0]
    assert scores[2] == 0


def test_dedupe_documents_keeps_best_dense_occurrence():
    first = doc("refund text", page=3, chunk=2)
    duplicate = doc("refund text", page=3, chunk=2)
    other = doc("refund text", page=4, chunk=5)
    assert r.dedupe_documents([first, duplicate, other]) == [first, other]


def test_dedupe_documents_falls_back_to_normalised_text():
    first = doc("Refund   text")
    duplicate = doc("refund text")
    assert r.dedupe_documents([first, duplicate]) == [first]


def test_rerank_prefers_phrase_and_coverage_over_raw_term_count():
    docs = [
        doc("refund " * 20, page=1),
        doc("the refund policy covers the purchase window", page=2),
        doc("nothing relevant", page=3),
    ]
    ranked = r.rerank_documents(docs, "refund policy", limit=2)
    assert ranked[0].metadata["page_number"] == 2


def test_rerank_keeps_dense_order_when_no_lexical_match():
    docs = [doc("alpha", page=1), doc("beta", page=2), doc("gamma", page=3)]
    ranked = r.rerank_documents(docs, "zzzz", limit=3)
    assert [d.metadata["page_number"] for d in ranked] == [1, 2, 3]


def test_rerank_handles_empty_candidates_and_zero_limit():
    assert r.rerank_documents([], "anything", limit=5) == []
    assert r.rerank_documents([doc("alpha", page=1)], "alpha", limit=0) == []


def test_is_concrete_question_rejects_follow_ups_and_pronouns():
    assert r.is_concrete_question("What are the support hours?") is True
    assert r.is_concrete_question("What is the refund window?") is True
    assert r.is_concrete_question("and the price?") is False
    assert r.is_concrete_question("What about that?") is False
    assert r.is_concrete_question("How is it encrypted?") is False


def test_should_rewrite_skips_call_for_concrete_question_without_history():
    request = ChatRequest(document_id="doc", message="What are the support hours?")
    assert r.useful_history([]) is False
    assert r.should_rewrite_query(request) is False


def test_should_rewrite_follow_up_without_history_or_any_question_with_history():
    follow_up = ChatRequest(document_id="doc", message="and the price?")
    assert r.should_rewrite_query(follow_up) is True

    with_history = ChatRequest(
        document_id="doc",
        message="What are the support hours?",
        history=[{"role": "user", "content": "tell me about the Team plan"}],
    )
    assert r.useful_history(with_history.history) is True
    assert r.should_rewrite_query(with_history) is True
