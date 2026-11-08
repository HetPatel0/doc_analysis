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


def test_upload_rejects_non_pdf_content_type(client):
    response = upload(client, b"%PDF-1.4", content_type="text/plain")
    assert response.status_code == 400
    assert "Only PDF" in response.json()["detail"]


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
        documents, "index_pdf", lambda *args: calls.append(args)
    )

    response = upload(client, b"%PDF-1.4\nfake body", name="../../evil name!.pdf")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "queued"
    assert body["file_name"] == "evil_name_.pdf"
    assert calls and calls[0][0] == body["document_id"]

    saved = list(isolated_storage["uploads"].glob(f"{body['document_id']}-*"))
    assert len(saved) == 1
    assert saved[0].read_bytes().startswith(b"%PDF")

    status = client.get(f"/documents/{body['document_id']}").json()
    assert status["status"] == "queued"
    assert status["ocr_used"] is False


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
    monkeypatch.setattr(documents, "index_pdf", lambda *args: calls.append(args))
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
    monkeypatch.setattr(documents, "index_pdf", lambda *args: None)
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
