from __future__ import annotations

from typing import Any

from app import dependencies as deps
from app.config import settings
from app.schemas import ChatRequest
from app.services import documents, query_rewrite, retrieval


def retrieve(request: ChatRequest) -> tuple[list[Any], list[dict[str, Any]]]:
    """Hybrid retrieval for one chat turn.

    Dense search fetches a candidate pool, BM25 scores that pool, and the fused
    result is reranked down to the final top-k. Query rewriting is best-effort:
    it falls back to the deterministic query on any error or timeout.

    Returns the documents actually put in the prompt and their structured
    citations. Kept separate from prompt building so the eval harness and tests
    can score retrieval without an LLM call.
    """
    docs, citations, _ = retrieve_with_query(request)
    return docs, citations


def retrieve_with_query(
    request: ChatRequest,
) -> tuple[list[Any], list[dict[str, Any]], str]:
    """Like :func:`retrieve`, but also returns the query that was searched.

    The eval harness uses the query to record whether the rewrite actually ran
    instead of silently scoring the deterministic fallback.
    """
    from langchain_community.vectorstores import Chroma

    vectorstore_path = documents.ensure_document_exists(request.document_id)

    vector_store = Chroma(
        persist_directory=str(vectorstore_path),
        embedding_function=deps.get_embedding_model(),
    )

    retrieval_query = query_rewrite.rewrite_query(request)
    # Pure similarity keeps a meaningful dense rank for reciprocal rank fusion.
    # MMR's diversity objective is now handled by the lexical signal + dedupe,
    # and MMR cannot expose the ranking RRF needs.
    candidate_k = max(settings.retrieval_fetch_k * 2, 20)
    retriever = vector_store.as_retriever(
        search_type="similarity",
        search_kwargs={"k": candidate_k},
    )

    retrieved_docs = retriever.invoke(retrieval_query)
    docs = retrieval.rerank_documents(
        retrieved_docs,
        retrieval_query,
        settings.retrieval_top_k,
        rrf_k=settings.retrieval_rrf_k,
    )
    return docs, retrieval.build_citations(docs), retrieval_query


def prepare_chat(
    request: ChatRequest,
) -> tuple[Any, list[str], list[dict[str, Any]]]:
    """Run retrieval and build the final prompt (shared by /chat + /chat/stream)."""
    docs, citations = retrieve(request)
    context, sources = retrieval.format_context(docs)

    final_prompt = deps.get_prompt().invoke(
        {
            "context": context,
            "history": retrieval.format_history(request.history),
            "question": request.message,
        }
    )
    return final_prompt, sources, citations
