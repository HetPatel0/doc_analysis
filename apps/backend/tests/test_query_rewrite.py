from __future__ import annotations

import time
from typing import ClassVar

import pytest
from app.config import settings
from app.schemas import ChatRequest
from app.services import query_rewrite

FALLBACK_HISTORY = [{"role": "user", "content": "tell me about the Team plan"}]


class FakePrompt:
    calls: ClassVar[list[dict]] = []

    @classmethod
    def reset(cls):
        cls.calls = []

    def invoke(self, values):
        type(self).calls.append(dict(values))
        return values


class FakeResponse:
    def __init__(self, content):
        self.content = content


@pytest.fixture
def rewrite_deps(monkeypatch):
    FakePrompt.reset()
    monkeypatch.setattr(query_rewrite.deps, "get_query_rewrite_prompt", FakePrompt)
    monkeypatch.setattr(settings, "query_rewrite", True)
    monkeypatch.setattr(settings, "query_rewrite_timeout_seconds", 1.0)


def request(message: str, history=None) -> ChatRequest:
    return ChatRequest(
        document_id="doc",
        message=message,
        history=history if history is not None else list(FALLBACK_HISTORY),
    )


def test_falls_back_to_deterministic_query_on_llm_error(rewrite_deps, monkeypatch):
    def boom(prompt):
        raise RuntimeError("network down")

    monkeypatch.setattr(query_rewrite.deps, "get_llm", lambda: type("L", (), {"invoke": boom})())

    result = query_rewrite.rewrite_query(request("what does it cost?"))

    assert result == "tell me about the Team plan\nwhat does it cost?"
    assert FakePrompt.calls


def test_falls_back_on_timeout_without_blocking(rewrite_deps, monkeypatch):
    monkeypatch.setattr(settings, "query_rewrite_timeout_seconds", 0.02)

    class SlowLLM:
        def invoke(self, prompt):
            time.sleep(0.3)
            return FakeResponse("too late")

    monkeypatch.setattr(query_rewrite.deps, "get_llm", SlowLLM)

    started = time.perf_counter()
    result = query_rewrite.rewrite_query(request("what does it cost?"))
    elapsed = time.perf_counter() - started

    assert result == "tell me about the Team plan\nwhat does it cost?"
    assert elapsed < 0.2


def test_disabled_setting_never_calls_the_model(rewrite_deps, monkeypatch):
    monkeypatch.setattr(settings, "query_rewrite", False)
    monkeypatch.setattr(
        query_rewrite.deps,
        "get_llm",
        lambda: pytest.fail("rewrite model must not be called when disabled"),
    )

    assert (
        query_rewrite.rewrite_query(request("what does it cost?"))
        == "tell me about the Team plan\nwhat does it cost?"
    )


def test_concrete_question_without_history_skips_the_extra_call(
    rewrite_deps, monkeypatch
):
    monkeypatch.setattr(
        query_rewrite.deps,
        "get_llm",
        lambda: pytest.fail("rewrite model must not be called"),
    )

    result = query_rewrite.rewrite_query(request("What are the support hours?", []))

    assert result == "What are the support hours?"
    assert FakePrompt.calls == []


def test_follow_up_without_history_still_rewrites(rewrite_deps, monkeypatch):
    monkeypatch.setattr(
        query_rewrite.deps,
        "get_llm",
        lambda: type(
            "L", (), {"invoke": lambda self, prompt: FakeResponse("Starter plan price")}
        )(),
    )

    result = query_rewrite.rewrite_query(request("and the price?", []))

    assert result == "Starter plan price"
    assert FakePrompt.calls[0]["question"] == "and the price?"


def test_rewrite_uses_history_and_cleans_model_output(rewrite_deps, monkeypatch):
    monkeypatch.setattr(
        query_rewrite.deps,
        "get_llm",
        lambda: type(
            "L",
            (),
            {
                "invoke": lambda self, prompt: FakeResponse(
                    'Query: "What does the Team plan cost?"\n'
                )
            },
        )(),
    )

    result = query_rewrite.rewrite_query(request("and the price?"))

    assert result == "What does the Team plan cost?"
    assert "tell me about the Team plan" in FakePrompt.calls[0]["history"]


def test_empty_model_output_falls_back(rewrite_deps, monkeypatch):
    monkeypatch.setattr(
        query_rewrite.deps,
        "get_llm",
        lambda: type("L", (), {"invoke": lambda self, prompt: FakeResponse("  \n")})(),
    )

    result = query_rewrite.rewrite_query(request("and the price?"))

    assert result == "tell me about the Team plan\nand the price?"
