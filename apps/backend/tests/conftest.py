"""Shared pytest setup.

Every test gets its own upload/vectorstore directories so nothing touches the
developer's real `uploads/` or `vectorstores/` folders. All LLM/embedding calls
are mocked per test — the suite must run offline and without an API key.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))
sys.path.insert(0, str(BACKEND_ROOT / "tests"))

from app.config import settings  # noqa: E402
from app.services import store as rag_store  # noqa: E402


@pytest.fixture(autouse=True)
def isolated_storage(tmp_path, monkeypatch):
    uploads = tmp_path / "uploads"
    vectorstores = tmp_path / "vectorstores"
    uploads.mkdir()
    vectorstores.mkdir()
    monkeypatch.setattr(settings, "uploads_dir", uploads)
    monkeypatch.setattr(settings, "vectorstores_dir", vectorstores)
    # The suite never touches Postgres: every test gets a fresh memory store.
    rag_store.set_store(rag_store.MemoryStore())
    yield {"uploads": uploads, "vectorstores": vectorstores}
    rag_store.set_store(None)


@pytest.fixture
def api_secret(monkeypatch):
    monkeypatch.setattr(settings, "api_secret", "test-secret")
    return "test-secret"


@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from main import app

    # Deliberately not a context manager: that would run the lifespan hook and
    # warm the real embedding model (network + API key).
    return TestClient(app)


@pytest.fixture
def golden_pdf() -> bytes:
    return (BACKEND_ROOT / "tests" / "fixtures" / "nimbus-notes.pdf").read_bytes()
