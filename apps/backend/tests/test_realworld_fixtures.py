"""Checks that the committed real-world fixtures still exercise what they claim.

The eval is only meaningful if the scan has no text layer (otherwise OCR is
never reached), the messy report still extracts, and the DOCX/URL fixtures load
through the same loaders production uses. The OCR check is skipped on machines
without the tesseract/poppler binaries; CI installs only the Python deps.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from app.services import loaders
from pypdf import PdfReader

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "realworld"


def pdf_text(name: str) -> str:
    reader = PdfReader(FIXTURES / name)
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def test_scanned_fixture_has_pages_but_no_text_layer():
    reader = PdfReader(FIXTURES / "scan-refunds.pdf")

    assert len(reader.pages) == 3
    assert pdf_text("scan-refunds.pdf").strip() == ""


def test_messy_report_still_has_extractable_facts():
    text = pdf_text("messy-report.pdf")

    assert "4.8 million" in text
    assert "108 percent" in text
    assert "84 employees" in text


def test_docx_and_url_text_load_through_production_loaders():
    docx_docs, docx_pages = loaders.load_document(
        FIXTURES / "policy.docx", loaders.DOCX
    )
    url_docs, url_pages = loaders.load_document(
        FIXTURES / "pricing.txt", loaders.URL
    )

    assert docx_pages == 1
    assert "750 USD" in docx_docs[0].page_content
    assert "40 USD per month" in docx_docs[0].page_content
    assert url_pages == 1
    assert "14-day free trial" in url_docs[0].page_content


@pytest.mark.skipif(
    not (shutil.which("tesseract") and shutil.which("pdftoppm")),
    reason="tesseract/poppler are not installed",
)
def test_scanned_fixture_is_readable_by_local_ocr(monkeypatch):
    from app.config import settings
    from app.services import ocr

    monkeypatch.setattr(settings, "ocr_provider", "tesseract")

    result = ocr.ocr_pdf(FIXTURES / "scan-refunds.pdf", "scan-refunds.pdf")
    text = " ".join(document.page_content for document in result.documents)

    assert result.provider == "tesseract"
    assert "21 days" in text
    assert "48 hours" in text
