from __future__ import annotations

import json
from pathlib import Path
from typing import ClassVar

import pytest
from app.schemas import ChatRequest
from app.services import chat as chat_service
from langchain_core.documents import Document


class FakeRetriever:
    def __init__(self, docs):
        self.docs = docs
        self.queries: list[str] = []

    def invoke(self, query):
        self.queries.append(query)
        return self.docs


class FakeVectorStore:
    docs: ClassVar[list[Document]] = []
    last_retriever_kwargs: ClassVar[dict | None] = None

    def __init__(self, **kwargs):
        self.kwargs = kwargs

    def as_retriever(self, **kwargs):
        type(self).last_retriever_kwargs = kwargs
        return FakeRetriever(list(self.docs))


@pytest.fixture
def fake_store(monkeypatch):
    import langchain_community.vectorstores

    monkeypatch.setattr(langchain_community.vectorstores, "Chroma", FakeVectorStore)
    monkeypatch.setattr(
        chat_service.documents,
        "ensure_document_exists",
        lambda document_id: Path("/tmp/does-not-need-to-exist"),
    )
    monkeypatch.setattr(chat_service.deps, "get_embedding_model", lambda: "embed")
    return FakeVectorStore


def test_retrieve_reranks_and_builds_citations(fake_store, monkeypatch):
    fake_store.docs = [
        Document(page_content="unrelated", metadata={"page_number": 1, "chunk_index": 0}),
        Document(
            page_content="The refund window is 14 days.",
            metadata={"page_number": 3, "chunk_index": 2},
        ),
    ]
    monkeypatch.setattr(chat_service.settings, "retrieval_top_k", 1)

    request = ChatRequest(document_id="doc", message="refund window")
    docs, citations = chat_service.retrieve(request)

    assert len(docs) == 1
    assert docs[0].metadata["page_number"] == 3
    assert citations == [{"label": "p. 3, chunk 3", "page": 3, "chunk": 3}]


def test_retrieve_fetches_a_similarity_candidate_pool(fake_store, monkeypatch):
    fake_store.docs = []
    monkeypatch.setattr(chat_service.settings, "retrieval_fetch_k", 7)

    chat_service.retrieve(ChatRequest(document_id="doc", message="hello there"))

    kwargs = FakeVectorStore.last_retriever_kwargs
    assert kwargs["search_type"] == "similarity"
    assert kwargs["search_kwargs"]["k"] >= 20


def test_prepare_chat_builds_prompt_with_history(fake_store, monkeypatch):
    fake_store.docs = [
        Document(page_content="Starter costs 9 USD.", metadata={"page_number": 2})
    ]
    captured = {}

    class FakePrompt:
        def invoke(self, values):
            captured.update(values)
            return {"rendered": values}

    monkeypatch.setattr(chat_service.deps, "get_prompt", lambda: FakePrompt())

    request = ChatRequest(
        document_id="doc",
        message="how much is starter?",
        history=[{"role": "user", "content": "hi"}],
    )
    prompt, sources, citations = chat_service.prepare_chat(request)

    assert prompt["rendered"]["context"].startswith("[p. 2]")
    assert "User: hi" in captured["history"]
    assert captured["question"] == "how much is starter?"
    assert sources == ["p. 2"]
    assert citations[0]["page"] == 2


def test_chat_endpoint_returns_answer_with_sources(client, monkeypatch):
    class FakeLLM:
        def invoke(self, prompt):
            return type("Msg", (), {"content": "It costs 9 USD."})()

    monkeypatch.setattr(
        "app.routers.chat.chat_service.prepare_chat",
        lambda request: ("prompt", ["p. 2"], [{"label": "p. 2", "page": 2, "chunk": None}]),
    )
    monkeypatch.setattr("app.routers.chat.deps.get_llm", lambda: FakeLLM())

    response = client.post(
        "/chat", json={"document_id": "doc", "message": "price?", "history": []}
    )

    body = response.json()
    assert response.status_code == 200
    assert body["answer"] == "It costs 9 USD.\n\nSources: p. 2"
    assert body["citations"][0]["page"] == 2


def test_chat_stream_emits_sources_tokens_and_done(client, monkeypatch):
    class FakeLLM:
        def stream(self, prompt):
            for token in ["Hel", "lo"]:
                yield type("Chunk", (), {"content": token})()

    monkeypatch.setattr(
        "app.routers.chat.chat_service.prepare_chat",
        lambda request: ("prompt", ["p. 1"], [{"label": "p. 1", "page": 1, "chunk": None}]),
    )
    monkeypatch.setattr("app.routers.chat.deps.get_llm", lambda: FakeLLM())

    response = client.post(
        "/chat/stream", json={"document_id": "doc", "message": "hi", "history": []}
    )

    assert response.status_code == 200
    events = [
        line.split("event: ", 1)[1]
        for line in response.text.splitlines()
        if line.startswith("event: ")
    ]
    assert events[0] == "sources"
    assert events[-1] == "done"
    assert events.count("token") >= 2
    payloads = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]
    assert payloads[0]["citations"][0]["page"] == 1
    assert "Sources: p. 1" in "".join(p["token"] for p in payloads if "token" in p)


def test_chat_stream_reports_llm_errors(client, monkeypatch):
    class BrokenLLM:
        def stream(self, prompt):
            raise RuntimeError("quota exceeded")
            yield  # pragma: no cover - keeps this a generator

    monkeypatch.setattr(
        "app.routers.chat.chat_service.prepare_chat",
        lambda request: ("prompt", [], []),
    )
    monkeypatch.setattr("app.routers.chat.deps.get_llm", lambda: BrokenLLM())

    response = client.post(
        "/chat/stream", json={"document_id": "doc", "message": "hi", "history": []}
    )

    assert "event: error" in response.text
    assert "quota exceeded" in response.text
