"""Cheap upload-time document insights: summary, key points, action items, quiz.

Runs one extra Mistral call after indexing. Any failure is non-fatal: the
document still becomes `ready`, just without insights.
"""

from __future__ import annotations

import json
import re
from typing import Any, Iterable

from app import dependencies as deps
from app.observability import capture_exception

MAX_SOURCE_CHARS = 12_000
MAX_CHUNKS = 12
MAX_LIST_ITEMS = 6
MAX_QUIZ_ITEMS = 5

PROMPT = """You are analysing a document so the reader gets a quick overview.

Read the excerpt below and reply with STRICT JSON only (no markdown fences,
no commentary) using exactly these keys:

{{
  "summary": "3-5 sentence plain-language summary",
  "key_points": ["3-6 short key takeaways"],
  "action_items": ["0-5 concrete action items, or [] if none"],
  "quiz": [{{"question": "question about the document", "answer": "short answer"}}]
}}

Include 3 quiz questions. Base everything only on the excerpt.

Document excerpt:
{text}
"""

EMPTY_INSIGHTS: dict[str, Any] = {
    "summary": None,
    "key_points": [],
    "action_items": [],
    "quiz": [],
}


def _excerpt(chunks: Iterable[Any]) -> str:
    chunk_list = list(chunks)[:MAX_CHUNKS]
    if not chunk_list:
        return ""

    per_chunk = max(400, MAX_SOURCE_CHARS // len(chunk_list))
    parts: list[str] = []
    used = 0

    for chunk in chunk_list:
        text = getattr(chunk, "page_content", "") or ""
        text = text.strip()
        if not text:
            continue
        piece = text[:per_chunk]
        parts.append(piece)
        used += len(piece)
        if used >= MAX_SOURCE_CHARS:
            break

    return "\n\n".join(parts)[:MAX_SOURCE_CHARS]


def _parse_json(raw: str) -> dict[str, Any] | None:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None

    try:
        payload = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None

    return payload if isinstance(payload, dict) else None


def _string_list(value: Any, limit: int = MAX_LIST_ITEMS) -> list[str]:
    if not isinstance(value, list):
        return []

    items: list[str] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            items.append(item.strip()[:400])
        if len(items) >= limit:
            break
    return items


def _quiz(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []

    questions: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        question = item.get("question")
        answer = item.get("answer")
        if not isinstance(question, str) or not question.strip():
            continue
        questions.append(
            {
                "question": question.strip()[:400],
                "answer": (answer if isinstance(answer, str) else "").strip()[:600],
            }
        )
        if len(questions) >= MAX_QUIZ_ITEMS:
            break
    return questions


def generate_insights(chunks: Iterable[Any]) -> dict[str, Any]:
    """Return summary/key_points/action_items/quiz for indexed chunks."""
    text = _excerpt(chunks)
    if not text:
        return dict(EMPTY_INSIGHTS)

    try:
        response = deps.get_llm().invoke(PROMPT.format(text=text))
        content = response.content
        raw = content if isinstance(content, str) else str(content)
        payload = _parse_json(raw)
    except Exception as exc:  # noqa: BLE001 - insights must never fail indexing
        capture_exception(exc)
        return dict(EMPTY_INSIGHTS)

    if not payload:
        return dict(EMPTY_INSIGHTS)

    summary = payload.get("summary")
    return {
        "summary": summary.strip()[:4000] if isinstance(summary, str) else None,
        "key_points": _string_list(payload.get("key_points")),
        "action_items": _string_list(payload.get("action_items")),
        "quiz": _quiz(payload.get("quiz")),
    }
