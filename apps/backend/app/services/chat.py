from __future__ import annotations

from typing import Any

from app import dependencies as deps
from app.config import settings
from app.schemas import ChatRequest
from app.services import documents, retrieval


def prepare_chat(request: ChatRequest) -> tuple[Any, list[str]]:
    """Run retrieval and build the final prompt (shared by /chat + /chat/stream)."""
    from langchain_community.vectorstores import Chroma

    vectorstore_path = documents.ensure_document_exists(request.document_id)

    vector_store = Chroma(
        persist_directory=str(vectorstore_path),
        embedding_function=deps.get_embedding_model(),
    )

    retrieval_query = retrieval.build_retrieval_query(request)
    retriever = vector_store.as_retriever(
        search_type="mmr",
        search_kwargs={
            "k": settings.retrieval_fetch_k,
            "fetch_k": max(settings.retrieval_fetch_k * 2, 20),
            "lambda_mult": 0.5,
        },
    )

    retrieved_docs = retriever.invoke(retrieval_query)
    docs = retrieval.rerank_documents(
        retrieved_docs, retrieval_query, settings.retrieval_top_k
    )
    context, sources = retrieval.format_context(docs)

    final_prompt = deps.get_prompt().invoke(
        {
            "context": context,
            "history": retrieval.format_history(request.history),
            "question": request.message,
        }
    )
    return final_prompt, sources
