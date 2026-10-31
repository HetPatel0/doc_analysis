from __future__ import annotations

import json
from typing import ClassVar

from app.services import documents, insights, ocr
from langchain_core.documents import Document


class FakeSplitter:
    """Deterministic stand-in for the tiktoken splitter (no network needed)."""

    window = 300

    def __init__(self, **kwargs):
        self.kwargs = kwargs

    @classmethod
    def from_tiktoken_encoder(cls, **kwargs):
        return cls(**kwargs)

    def split_documents(self, docs):
        chunks = []
        for source in docs:
            text = source.page_content
            for start in range(0, len(text), self.window):
                part = text[start : start + self.window]
                if len(part.strip()) >= 80:
                    chunks.append(
                        Document(page_content=part, metadata=dict(source.metadata))
                    )
        return chunks


class FakeChroma:
    captured: ClassVar[dict] = {}

    @classmethod
    def from_documents(cls, documents, embedding, persist_directory):
        cls.captured = {
            "documents": documents,
            "embedding": embedding,
            "persist_directory": persist_directory,
        }


def install_fake_indexing(monkeypatch, pages: list[str], *, loader_error=None):
    class Loader:
        def __init__(self, path):
            self.path = path

        def load(self):
            if loader_error:
                raise loader_error
            return [
                Document(page_content=text, metadata={"page": index})
                for index, text in enumerate(pages)
            ]

    FakeChroma.captured = {}
    monkeypatch.setattr(
        documents.deps,
        "get_indexing_dependencies",
        lambda: (Loader, FakeChroma, FakeSplitter),
    )
    monkeypatch.setattr(documents.deps, "get_embedding_model", lambda: "fake-embed")
    monkeypatch.setattr(
        documents.insights, "generate_insights", lambda chunks: dict(insights.EMPTY_INSIGHTS)
    )


def status(document_id: str) -> dict:
    return json.loads(documents.get_document_status_path(document_id).read_text())


def test_text_pdf_indexes_and_records_metadata(monkeypatch, tmp_path):
    pages = ["A" * 400, "B" * 400]
    install_fake_indexing(monkeypatch, pages)
    ocr_calls: list = []
    monkeypatch.setattr(documents.ocr, "ocr_pdf", lambda *a: ocr_calls.append(a))

    upload = tmp_path / "doc-1.pdf"
    upload.write_bytes(b"%PDF-1.4")
    documents.index_pdf("doc1", "doc.pdf", upload)

    result = status("doc1")
    assert result["status"] == "ready"
    assert result["ocr_used"] is False
    assert result["ocr_provider"] is None
    assert ocr_calls == []

    chunks = FakeChroma.captured["documents"]
    assert result["chunks_indexed"] == len(chunks)
    assert chunks[0].metadata["document_id"] == "doc1"
    assert chunks[0].metadata["file_name"] == "doc.pdf"
    assert [c.metadata["chunk_index"] for c in chunks] == list(range(len(chunks)))
    assert [c.metadata["page_number"] for c in chunks] == [1, 1, 2, 2]
    assert chunks[0].metadata["source_label"] == "p. 1, chunk 1"
    assert FakeChroma.captured["persist_directory"].endswith("doc1")


def test_scanned_pdf_falls_back_to_ocr(monkeypatch, tmp_path):
    install_fake_indexing(monkeypatch, ["", ""])
    ocr_docs = [
        Document(
            page_content="scanned text " * 20,
            metadata={"page": 0, "page_number": 1, "ocr": True, "ocr_provider": "tesseract"},
        )
    ]
    monkeypatch.setattr(
        documents.ocr,
        "ocr_pdf",
        lambda path, name: ocr.OcrResult(documents=ocr_docs, provider="tesseract"),
    )

    upload = tmp_path / "scan.pdf"
    upload.write_bytes(b"%PDF-1.4")
    documents.index_pdf("doc2", "scan.pdf", upload)

    result = status("doc2")
    assert result["status"] == "ready"
    assert result["ocr_used"] is True
    assert result["ocr_provider"] == "tesseract"
    assert result["chunks_indexed"] >= 1
    assert FakeChroma.captured["documents"][0].metadata["page_number"] == 1


def test_ocr_text_is_ignored_when_thinner_than_text_layer(monkeypatch, tmp_path):
    # 3 pages, 250 chars total -> below the 100 chars/page threshold.
    install_fake_indexing(monkeypatch, ["C" * 250, "", ""])
    monkeypatch.setattr(
        documents.ocr,
        "ocr_pdf",
        lambda path, name: ocr.OcrResult(
            documents=[Document(page_content="tiny", metadata={})], provider="mistral"
        ),
    )

    upload = tmp_path / "sparse.pdf"
    upload.write_bytes(b"%PDF-1.4")
    documents.index_pdf("doc3", "sparse.pdf", upload)

    result = status("doc3")
    assert result["status"] == "ready"
    assert result["ocr_used"] is False
    assert FakeChroma.captured["documents"][0].page_content.startswith("CCC")


def test_ocr_unavailable_marks_document_failed(monkeypatch, tmp_path):
    install_fake_indexing(monkeypatch, [""])

    def boom(path, name):
        raise ocr.OcrUnavailable("This PDF looks like a scan, but OCR is disabled")

    monkeypatch.setattr(documents.ocr, "ocr_pdf", boom)

    upload = tmp_path / "scan2.pdf"
    upload.write_bytes(b"%PDF-1.4")
    documents.index_pdf("doc4", "scan2.pdf", upload)

    result = status("doc4")
    assert result["status"] == "failed"
    assert "OCR" in result["error"]


def test_loader_error_still_tries_ocr(monkeypatch, tmp_path):
    install_fake_indexing(monkeypatch, [], loader_error=ValueError("cannot parse"))
    monkeypatch.setattr(
        documents.ocr,
        "ocr_pdf",
        lambda path, name: ocr.OcrResult(
            documents=[
                Document(
                    page_content="recovered text " * 30,
                    metadata={"page": 0, "page_number": 1, "ocr": True},
                )
            ],
            provider="mistral",
        ),
    )

    upload = tmp_path / "weird.pdf"
    upload.write_bytes(b"%PDF-1.4")
    documents.index_pdf("doc5", "weird.pdf", upload)

    result = status("doc5")
    assert result["status"] == "ready"
    assert result["ocr_used"] is True


def test_empty_pdf_with_ocr_off_fails_with_readable_pages_error(monkeypatch, tmp_path):
    from app.config import settings

    install_fake_indexing(monkeypatch, [""])
    monkeypatch.setattr(settings, "ocr_provider", "off")

    upload = tmp_path / "empty.pdf"
    upload.write_bytes(b"%PDF-1.4")
    documents.index_pdf("doc6", "empty.pdf", upload)

    result = status("doc6")
    assert result["status"] == "failed"
    assert "readable pages" in result["error"]


def test_indexing_failure_preserves_file_name(monkeypatch, tmp_path):
    from app.config import settings

    install_fake_indexing(monkeypatch, ["x" * 400])

    def boom(chunks):
        raise RuntimeError("llm down")

    monkeypatch.setattr(documents.insights, "generate_insights", boom)
    monkeypatch.setattr(settings, "ocr_provider", "off")

    upload = tmp_path / "ok.pdf"
    upload.write_bytes(b"%PDF-1.4")
    documents.index_pdf("doc7", "ok.pdf", upload)

    result = status("doc7")
    assert result["status"] == "failed"
    assert result["file_name"] == "ok.pdf"
    assert "llm down" in result["error"]


def test_large_page_is_split_into_multiple_chunks(monkeypatch, tmp_path):
    install_fake_indexing(monkeypatch, ["A" * 900])
    upload = tmp_path / "long.pdf"
    upload.write_bytes(b"%PDF-1.4")
    documents.index_pdf("doc8", "long.pdf", upload)

    assert status("doc8")["chunks_indexed"] > 1
