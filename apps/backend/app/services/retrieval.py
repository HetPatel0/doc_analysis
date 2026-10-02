from __future__ import annotations

import re
from typing import Any

from app.schemas import ChatRequest


def normalize_page_number(metadata: dict[str, Any]) -> int | None:
    page = metadata.get("page")
    if isinstance(page, int):
        return page + 1
    if isinstance(page, str) and page.isdigit():
        return int(page) + 1
    return None


def source_label(metadata: dict[str, Any]) -> str:
    page_number = metadata.get("page_number") or normalize_page_number(metadata)
    chunk_index = metadata.get("chunk_index")

    parts: list[str] = []
    if page_number:
        parts.append(f"p. {page_number}")
    if isinstance(chunk_index, int):
        parts.append(f"chunk {chunk_index + 1}")

    return ", ".join(parts) if parts else "document"


def format_context(docs: list[Any]) -> tuple[str, list[str]]:
    context_blocks: list[str] = []
    sources: list[str] = []

    for doc in docs:
        label = source_label(doc.metadata)
        if label not in sources:
            sources.append(label)
        context_blocks.append(f"[{label}]\n{doc.page_content.strip()}")

    return "\n\n".join(context_blocks), sources


def format_history(history: list[dict[str, str]]) -> str:
    lines: list[str] = []

    for item in history[-6:]:
        role = item.get("role", "").strip().lower()
        content = item.get("content", "").strip()
        if role not in {"user", "assistant"} or not content:
            continue
        lines.append(f"{role.title()}: {content[:800]}")

    return "\n".join(lines) if lines else "No previous conversation."


def build_retrieval_query(request: ChatRequest) -> str:
    recent_user_turns = [
        item.get("content", "").strip()
        for item in request.history[-6:]
        if item.get("role") == "user" and item.get("content", "").strip()
    ]
    return "\n".join([*recent_user_turns, request.message.strip()])


def query_terms(query: str) -> set[str]:
    return set(re.findall(r"[a-zA-Z0-9]{3,}", query.lower()))


def rerank_documents(docs: list[Any], query: str, limit: int) -> list[Any]:
    terms = query_terms(query)

    def score_doc(position_and_doc: tuple[int, Any]) -> tuple[float, int]:
        position, doc = position_and_doc
        content = doc.page_content.lower()
        lexical_hits = sum(1 for term in terms if term in content)
        page_bonus = 0.1 if doc.metadata.get("page_number") else 0
        return (lexical_hits + page_bonus, -position)

    ranked = sorted(enumerate(docs), key=score_doc, reverse=True)
    return [doc for _, doc in ranked[:limit]]


def with_source_footer(answer: Any, sources: list[str]) -> str:
    text = answer if isinstance(answer, str) else str(answer)
    if not sources or "I could not find the answer in the document." in text:
        return text
    if re.search(r"\[(p\.|document)", text, flags=re.IGNORECASE):
        return text
    return f"{text}\n\nSources: {', '.join(sources)}"
