from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from app.config import settings
from app.services import documents
from app.services.store import get_store


def upload(client, payload: bytes, name: str = "notes.pdf", content_type: str = "application/pdf"):
    return client.post(
        "/upload", files={"file": (name, payload, content_type)}
    )


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_upload_rejects_unsupported_type(client):
    response = upload(
        client,
        b"MZ\x90\x00",
        name="notes.exe",
        content_type="application/octet-stream",
    )
    assert response.status_code == 400
    assert "Unsupported file type" in response.json()["detail"]


def test_upload_rejects_empty_file(client):
    assert upload(client, b"").status_code == 400


def test_upload_rejects_oversized_file(client, monkeypatch):
    monkeypatch.setattr(settings, "max_upload_mb", 0)
    response = upload(client, b"%PDF-1.4 small")
    assert response.status_code == 413
    assert "limit" in response.json()["detail"].lower()


def test_upload_rejects_missing_magic_bytes(client):
    response = upload(client, b"NOT-A-PDF")
    assert response.status_code == 400
    assert "valid PDF" in response.json()["detail"]


def test_upload_queues_indexing_and_sanitizes_name(client, monkeypatch, isolated_storage):
    calls: list[tuple] = []
    monkeypatch.setattr(
        documents, "index_document", lambda *args: calls.append(args)
    )

    response = upload(client, b"%PDF-1.4\nfake body", name="../../evil name!.pdf")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "queued"
    assert body["file_name"] == "evil_name_.pdf"
    assert body["source_kind"] == "pdf"
    assert calls and calls[0][0] == body["document_id"]

    saved = list(isolated_storage["uploads"].glob(f"{body['document_id']}-*"))
    assert len(saved) == 1
    assert saved[0].read_bytes().startswith(b"%PDF")

    status = client.get(f"/documents/{body['document_id']}").json()
    assert status["status"] == "queued"
    assert status["ocr_used"] is False
    assert status["source_kind"] == "pdf"


def test_upload_accepts_text_markdown_and_docx(client, monkeypatch):
    calls: list[tuple] = []
    monkeypatch.setattr(
        documents, "index_document", lambda *args: calls.append(args)
    )

    txt = upload(
        client, b"Quarterly revenue grew 12%.\n", name="notes.txt", content_type="text/plain"
    )
    md = upload(
        client,
        b"# Title\n\nA short markdown note.\n",
        name="notes.md",
        content_type="text/markdown",
    )

    assert txt.status_code == 200
    assert txt.json()["source_kind"] == "txt"
    assert md.status_code == 200
    assert md.json()["source_kind"] == "md"
    assert [call[3] for call in calls] == ["txt", "md"]


def test_status_unknown_document_is_404(client):
    assert client.get("/documents/nope").status_code == 404


def test_status_defaults_ocr_fields(client):
    documents.write_document_status("legacy", file_name="old.pdf", status="ready")

    body = client.get("/documents/legacy").json()
    assert body["ocr_used"] is False
    assert body["ocr_provider"] is None
    assert body["key_points"] == []
    assert body["insights_status"] == "pending"
    assert body["updated_at"] is not None
    assert body["stalled"] is False


def test_status_marks_stuck_indexing_as_stalled(client):
    documents.write_document_status("stuck", file_name="a.pdf", status="indexing")
    get_store().statuses["stuck"]["updated_at"] = datetime.now(UTC) - timedelta(
        seconds=settings.index_stale_seconds + 60
    )

    body = client.get("/documents/stuck").json()
    assert body["status"] == "indexing"
    assert body["stalled"] is True


def test_status_never_marks_ready_as_stalled(client):
    documents.write_document_status("done", file_name="a.pdf", status="ready")
    get_store().statuses["done"]["updated_at"] = datetime.now(UTC) - timedelta(
        days=1
    )

    body = client.get("/documents/done").json()
    assert body["stalled"] is False


def test_file_endpoint_serves_uploaded_pdf(client, isolated_storage):
    documents.write_document_status("doc1", file_name="a.pdf", status="ready")
    (isolated_storage["uploads"] / "doc1-a.pdf").write_bytes(b"%PDF-1.4 body")

    response = client.get("/documents/doc1/file")
    assert response.status_code == 200
    assert response.content == b"%PDF-1.4 body"
    assert response.headers["content-type"] == "application/pdf"
    assert "a.pdf" in response.headers["content-disposition"]


def test_file_endpoint_404_when_upload_missing(client):
    documents.write_document_status("doc2", file_name="a.pdf", status="ready")
    assert client.get("/documents/doc2/file").status_code == 404


def test_file_endpoint_serves_text_media_type(client, isolated_storage):
    documents.write_document_status(
        "doc-text",
        file_name="notes.txt",
        status="ready",
        source_kind="txt",
        mime_type="text/plain; charset=utf-8",
    )
    (isolated_storage["uploads"] / "doc-text-notes.txt").write_text(
        "hello world", encoding="utf-8"
    )

    response = client.get("/documents/doc-text/file")
    assert response.status_code == 200
    assert response.content == b"hello world"
    assert response.headers["content-type"].startswith("text/plain")


def test_chunks_endpoint_returns_positions(client):
    from app.services.store import get_store
    from langchain_core.documents import Document

    documents.write_document_status("doc-chunks", file_name="notes.txt", status="ready")
    get_store().replace_chunks(
        "doc-chunks",
        [
            Document(
                page_content="first chunk",
                metadata={
                    "chunk_index": 0,
                    "page_number": None,
                    "start_index": 0,
                    "source_label": "chunk 1",
                },
            )
        ],
        [[1.0, 0.0]],
    )

    body = client.get("/documents/doc-chunks/chunks").json()
    assert body["chunks"] == [
        {
            "chunk_index": 0,
            "page_number": None,
            "start_index": 0,
            "source_label": "chunk 1",
        }
    ]


def test_url_import_queues_a_text_document(client, monkeypatch, isolated_storage):
    from app.services import url_import

    calls: list[tuple] = []
    monkeypatch.setattr(documents, "index_document", lambda *args: calls.append(args))
    monkeypatch.setattr(
        url_import,
        "import_url",
        lambda url: url_import.UrlImportResult(
            text="A useful article body. " * 5,
            title="Example article",
            final_url="https://example.com/article",
            content_type="text/html",
        ),
    )

    response = client.post("/import/url", json={"url": "https://example.com/article"})

    assert response.status_code == 200
    body = response.json()
    assert body["source_kind"] == "url"
    assert body["file_name"] == "Example_article.txt"
    assert body["source_url"] == "https://example.com/article"
    assert calls and calls[0][0] == body["document_id"]
    assert calls[0][3] == "url"

    saved = isolated_storage["uploads"] / f"{body['document_id']}-Example_article.txt"
    assert saved.read_text(encoding="utf-8").startswith("A useful article body.")

    status = client.get(f"/documents/{body['document_id']}").json()
    assert status["source_kind"] == "url"
    assert status["mime_type"].startswith("text/plain")


def test_url_import_maps_guard_errors_to_http(client, monkeypatch):
    from app.services import url_import

    def blocked(url):
        raise url_import.UrlImportError(
            "That URL points to a private or reserved address.", status_code=400
        )

    monkeypatch.setattr(url_import, "import_url", blocked)

    response = client.post("/import/url", json={"url": "http://127.0.0.1/secret"})

    assert response.status_code == 400
    assert "private or reserved" in response.json()["detail"]


def test_delete_removes_status_upload_and_vectorstore(client, isolated_storage):
    vectorstore = isolated_storage["vectorstores"] / "doc3"
    vectorstore.mkdir()
    (vectorstore / "chroma.sqlite3").write_text("x")
    documents.write_document_status("doc3", file_name="a.pdf", status="ready")
    (isolated_storage["uploads"] / "doc3-a.pdf").write_bytes(b"%PDF")

    response = client.delete("/documents/doc3")
    assert response.status_code == 200
    assert response.json()["status"] == "deleted"
    assert not vectorstore.exists()
    assert not (isolated_storage["vectorstores"] / "doc3.json").exists()
    assert not list(isolated_storage["uploads"].glob("doc3-*"))
    assert client.get("/documents/doc3").status_code == 404


def test_delete_unknown_document_is_404(client):
    assert client.delete("/documents/missing").status_code == 404


def test_retry_requeues_a_failed_document(client, isolated_storage, monkeypatch):
    calls: list[tuple] = []
    monkeypatch.setattr(documents, "index_document", lambda *args: calls.append(args))
    documents.write_document_status(
        "retry", file_name="a.pdf", status="failed", error="boom"
    )
    (isolated_storage["uploads"] / "retry-a.pdf").write_bytes(b"%PDF-1.4")

    response = client.post("/documents/retry/retry")

    assert response.status_code == 200
    assert response.json() == {"document_id": "retry", "status": "queued"}
    assert calls and calls[0][0] == "retry"
    assert client.get("/documents/retry").json()["status"] == "queued"


def test_retry_requeues_stalled_indexing(client, isolated_storage, monkeypatch):
    monkeypatch.setattr(documents, "index_document", lambda *args: None)
    documents.write_document_status("stuck", file_name="a.pdf", status="indexing")
    get_store().statuses["stuck"]["updated_at"] = datetime.now(UTC) - timedelta(
        seconds=settings.index_stale_seconds + 60
    )
    (isolated_storage["uploads"] / "stuck-a.pdf").write_bytes(b"%PDF-1.4")

    assert client.post("/documents/stuck/retry").status_code == 200


def test_retry_rejects_active_indexing(client, isolated_storage):
    documents.write_document_status("busy", file_name="a.pdf", status="indexing")
    (isolated_storage["uploads"] / "busy-a.pdf").write_bytes(b"%PDF-1.4")

    assert client.post("/documents/busy/retry").status_code == 409


def test_retry_rejects_ready_document(client, isolated_storage):
    documents.write_document_status("done", file_name="a.pdf", status="ready")
    (isolated_storage["uploads"] / "done-a.pdf").write_bytes(b"%PDF-1.4")

    assert client.post("/documents/done/retry").status_code == 409


def test_retry_404_when_upload_is_missing(client):
    documents.write_document_status("gone", file_name="a.pdf", status="failed")

    assert client.post("/documents/gone/retry").status_code == 404


def test_readiness_reports_the_store(client):
    response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_readiness_returns_503_when_the_store_is_down(client, monkeypatch):
    def boom() -> None:
        raise RuntimeError("store unavailable")

    monkeypatch.setattr(get_store(), "ping", boom)

    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json()["detail"] == "Vector store unavailable."


def test_auth_guard_blocks_requests_without_secret(client, api_secret):
    assert client.get("/documents/doc").status_code == 401
    assert upload(client, b"%PDF-1.4").status_code == 401

    ok = client.get("/documents/doc", headers={"X-Bookify-Secret": api_secret})
    # Auth passed; the document itself does not exist.
    assert ok.status_code == 404


def test_auth_guard_rejects_wrong_secret(client, api_secret):
    response = client.get(
        "/documents/doc", headers={"X-Bookify-Secret": "wrong"}
    )
    assert response.status_code == 401


def test_health_is_not_auth_guarded(client, api_secret):
    assert client.get("/health").status_code == 200


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("../../etc/passwd", "passwd.pdf"),
        ("my notes.pdf", "my_notes.pdf"),
        ("", "document.pdf"),
        ("report.PDF", "report.PDF"),
        ("nested/dir/scan", "scan.pdf"),
    ],
)
def test_sanitize_file_name(raw, expected):
    assert documents.sanitize_file_name(raw) == expected
