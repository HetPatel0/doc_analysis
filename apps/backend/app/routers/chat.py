from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app import dependencies as deps
from app.schemas import ChatRequest, ChatResponse
from app.security import require_backend_auth
from app.services import chat as chat_service
from app.services import retrieval

router = APIRouter(tags=["chat"])


def sse_event(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"


@router.post(
    "/chat", response_model=ChatResponse, dependencies=[Depends(require_backend_auth)]
)
def chat_with_document(request: ChatRequest) -> ChatResponse:
    final_prompt, sources = chat_service.prepare_chat(request)
    response = deps.get_llm().invoke(final_prompt)
    return ChatResponse(
        answer=retrieval.with_source_footer(response.content, sources),
        sources=sources,
    )


@router.post("/chat/stream", dependencies=[Depends(require_backend_auth)])
def chat_stream_with_document(request: ChatRequest) -> StreamingResponse:
    final_prompt, sources = chat_service.prepare_chat(request)

    def generate() -> Any:
        yield sse_event("sources", {"sources": sources})
        streamed: list[str] = []
        try:
            for chunk in deps.get_llm().stream(final_prompt):
                text = chunk.content if isinstance(chunk.content, str) else ""
                if text:
                    streamed.append(text)
                    yield sse_event("token", {"token": text})
        except Exception as exc:
            yield sse_event("error", {"detail": str(exc)})
            return

        full_text = "".join(streamed)
        footer_text = retrieval.with_source_footer(full_text, sources)
        if len(footer_text) > len(full_text):
            yield sse_event("token", {"token": footer_text[len(full_text):]})

        yield sse_event("done", {})

    return StreamingResponse(generate(), media_type="text/event-stream")
