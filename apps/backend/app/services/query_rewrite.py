from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from app import dependencies as deps
from app.config import settings
from app.schemas import ChatRequest
from app.services import retrieval

logger = logging.getLogger(__name__)

MAX_REWRITE_CHARS = 512


def _clean_rewrite(raw: Any) -> str:
    """Take the model's first useful line and strip common formatting noise."""
    if not isinstance(raw, str):
        return ""
    text = raw.strip()
    if not text:
        return ""

    text = text.splitlines()[0].strip()
    for prefix in ("query:", "search query:", "rewritten question:"):
        if text.lower().startswith(prefix):
            text = text[len(prefix) :].strip()
    text = text.strip("`'\" ").strip()
    return text[:MAX_REWRITE_CHARS]


def _invoke_with_timeout(prompt: Any, timeout: float) -> Any:
    """Run the rewrite in a worker thread so a slow call cannot block chat."""
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="rag-rewrite")
    future = executor.submit(lambda: deps.get_llm().invoke(prompt))
    try:
        return future.result(timeout=timeout)
    finally:
        # A timed-out request may still finish in the background; never join it
        # on the request path.
        executor.shutdown(wait=False, cancel_futures=True)


def rewrite_query(request: ChatRequest) -> str:
    """Build the query used for retrieval, falling back to today's behaviour.

    Any error, timeout or empty model output returns
    ``retrieval.build_retrieval_query`` (recent user turns + current question).
    """
    fallback = retrieval.build_retrieval_query(request)

    if not settings.query_rewrite:
        return fallback
    if not retrieval.should_rewrite_query(request):
        return fallback

    try:
        prompt = deps.get_query_rewrite_prompt().invoke(
            {
                "history": retrieval.format_history(request.history),
                "question": request.message,
            }
        )
        response = _invoke_with_timeout(
            prompt, settings.query_rewrite_timeout_seconds
        )
        rewritten = _clean_rewrite(getattr(response, "content", response))
    except Exception as exc:  # timeout, network, bad prompt, bad model output
        logger.warning("query rewrite failed, using deterministic query: %s", exc)
        return fallback

    return rewritten or fallback
