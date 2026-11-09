"""Offline tests for multi-format detection and loading."""

from __future__ import annotations

import io
import zipfile

import pytest
from app.services import loaders


def test_detect_kind_prefers_extension_then_mime():
    assert loaders.detect_kind("Report.PDF", "application/octet-stream") == "pdf"
    assert loaders.detect_kind("notes.markdown", None) == "md"
    assert loaders.detect_kind("notes", "text/plain") == "txt"
    assert loaders.detect_kind("notes", "text/markdown") == "md"
    assert (
        loaders.detect_kind(
            "resume",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        == "docx"
    )
    assert loaders.detect_kind("archive.zip", "application/zip") is None


@pytest.mark.parametrize(
    "raw,kind,expected",
    [
        ("notes", "txt", "notes.txt"),
        ("notes.md", "md", "notes.md"),
        ("notes.pdf", "docx", "notes.pdf.docx"),
        ("../../etc/passwd", "docx", "passwd.docx"),
        ("", "txt", "document.txt"),
        ("Example Article.txt", "url", "Example_Article.txt"),
    ],
)
def test_sanitize_file_name_matches_kind(raw, kind, expected):
    assert loaders.sanitize_file_name(raw, kind) == expected


def test_validate_bytes_accepts_each_kind(tmp_path):
    docx = io.BytesIO()
    with zipfile.ZipFile(docx, "w") as archive:
        archive.writestr("word/document.xml", "<w:document />")

    loaders.validate_bytes("pdf", b"%PDF-1.7")
    loaders.validate_bytes("docx", docx.getvalue())
    loaders.validate_bytes("txt", b"plain text\n")
    loaders.validate_bytes("md", b"# heading\n")
    loaders.validate_bytes("url", b"extracted text\n")


def test_validate_bytes_rejects_wrong_payloads():
    with pytest.raises(ValueError, match="valid PDF"):
        loaders.validate_bytes("pdf", b"not a pdf")
    with pytest.raises(ValueError, match="valid DOCX"):
        loaders.validate_bytes("docx", b"not a zip")
    with pytest.raises(ValueError, match="empty"):
        loaders.validate_bytes("txt", b"")

    binary = b"hello\x00world"
    with pytest.raises(ValueError, match="valid text"):
        loaders.validate_bytes("txt", binary)


def test_load_text_documents_splits_metadata_off_page(tmp_path):
    path = tmp_path / "notes.md"
    path.write_text("# Heading\n\nSome body text.\n", encoding="utf-8")

    docs, page_count = loaders.load_document(path, "md")

    assert page_count == 1
    assert len(docs) == 1
    assert docs[0].page_content.startswith("# Heading")
    assert "page" not in docs[0].metadata


def test_load_text_handles_utf16(tmp_path):
    path = tmp_path / "notes.txt"
    path.write_bytes("café notes".encode("utf-16"))

    docs, _ = loaders.load_document(path, "txt")

    assert docs[0].page_content == "café notes"


def test_load_docx_reads_paragraphs_and_tables(tmp_path):
    from docx import Document as DocxDocument

    document = DocxDocument()
    document.add_heading("Quarterly report", level=1)
    document.add_paragraph("Revenue grew by 12%.")
    table = document.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "Metric"
    table.cell(0, 1).text = "Value"
    table.cell(1, 0).text = "Revenue"
    table.cell(1, 1).text = "1200"

    path = tmp_path / "report.docx"
    document.save(path)

    docs, page_count = loaders.load_document(path, "docx")

    assert page_count == 1
    text = docs[0].page_content
    assert "Quarterly report" in text
    assert "Revenue grew by 12%." in text
    assert "Revenue | 1200" in text
    assert "page" not in docs[0].metadata


def test_load_invalid_docx_raises(tmp_path):
    path = tmp_path / "broken.docx"
    path.write_bytes(b"PK\x03\x04not really a zip")

    with pytest.raises(ValueError, match="Could not read the DOCX"):
        loaders.load_document(path, "docx")
