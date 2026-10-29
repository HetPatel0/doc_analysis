from __future__ import annotations

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    document_id: str
    message: str
    history: list[dict[str, str]] = Field(default_factory=list)


class Citation(BaseModel):
    label: str
    page: int | None = None
    chunk: int | None = None


class ChatResponse(BaseModel):
    answer: str
    sources: list[str] = Field(default_factory=list)
    citations: list[Citation] = Field(default_factory=list)


class QuizQuestion(BaseModel):
    question: str
    answer: str


class DocumentStatusResponse(BaseModel):
    document_id: str
    file_name: str
    status: str
    chunks_indexed: int | None = None
    error: str | None = None
    summary: str | None = None
    key_points: list[str] = Field(default_factory=list)
    action_items: list[str] = Field(default_factory=list)
    quiz: list[QuizQuestion] = Field(default_factory=list)
