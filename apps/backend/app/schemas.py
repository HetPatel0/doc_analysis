from __future__ import annotations

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    document_id: str
    message: str
    history: list[dict[str, str]] = Field(default_factory=list)


class ChatResponse(BaseModel):
    answer: str
    sources: list[str] = Field(default_factory=list)


class DocumentStatusResponse(BaseModel):
    document_id: str
    file_name: str
    status: str
    chunks_indexed: int | None = None
    error: str | None = None
