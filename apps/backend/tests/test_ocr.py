from __future__ import annotations

import subprocess
import sys
from types import SimpleNamespace

import pytest
from app.config import settings
from app.services import ocr
from langchain_core.documents import Document


def test_needs_ocr_for_empty_text():
    assert ocr.needs_ocr([], 0) is True
    assert ocr.needs_ocr([], 3) is True


def test_needs_ocr_uses_per_page_threshold(monkeypatch):
    monkeypatch.setattr(settings, "ocr_min_chars_per_page", 100)
    assert ocr.needs_ocr([Document(page_content="x" * 50)], 2) is True
    assert ocr.needs_ocr([Document(page_content="x" * 250)], 2) is False


def test_available_providers_are_ordered_cheapest_first(monkeypatch):
    monkeypatch.setattr(settings, "mistral_api_key", "key")
    monkeypatch.setattr(ocr.shutil, "which", lambda name: f"/usr/bin/{name}")
    assert ocr.available_providers() == ["tesseract", "mistral"]

    monkeypatch.setattr(ocr.shutil, "which", lambda name: None)
    assert ocr.available_providers() == ["mistral"]

    monkeypatch.setattr(settings, "mistral_api_key", "")
    assert ocr.available_providers() == []


def test_provider_chain_off_is_empty(monkeypatch):
    monkeypatch.setattr(settings, "ocr_provider", "off")
    assert ocr._provider_chain() == []


def test_provider_chain_forced_but_unavailable_raises(monkeypatch):
    monkeypatch.setattr(settings, "ocr_provider", "tesseract")
    monkeypatch.setattr(settings, "mistral_api_key", "")
    monkeypatch.setattr(ocr.shutil, "which", lambda name: None)
    with pytest.raises(ocr.OcrUnavailable, match="not available"):
        ocr._provider_chain()


def fake_mistral_client(pages):
    class FakeOcr:
        def process(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(pages=pages)

    calls = []
    return SimpleNamespace(ocr=FakeOcr()), calls


def test_mistral_pages_maps_response_to_documents(monkeypatch, tmp_path):
    client, calls = fake_mistral_client(
        [
            SimpleNamespace(index=0, markdown="# Page one\nhello"),
            SimpleNamespace(index=1, markdown=""),
        ]
    )
    monkeypatch.setattr(settings, "mistral_api_key", "key")
    monkeypatch.setitem(
        sys.modules,
        "mistralai.client",
        SimpleNamespace(Mistral=lambda api_key: client),
    )

    pdf = tmp_path / "scan.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    pages = ocr._mistral_pages(pdf, "scan.pdf")

    assert len(pages) == 1
    assert pages[0].page_content == "# Page one\nhello"
    assert pages[0].metadata == {
        "source": "scan.pdf",
        "page": 0,
        "page_number": 1,
        "ocr": True,
        "ocr_provider": "mistral",
    }
    assert calls[0]["document"]["document_url"].startswith(
        "data:application/pdf;base64,"
    )
    assert calls[0]["model"] == settings.ocr_model


def test_tesseract_pages_reads_rendered_images(monkeypatch, tmp_path):
    images = [tmp_path / "page-1.png", tmp_path / "page-2.png"]
    for image in images:
        image.write_bytes(b"png")
    monkeypatch.setattr(ocr, "_render_pages", lambda path, workdir: images)
    monkeypatch.setattr(
        ocr.subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(
            args, 0, stdout=f"text from {args[0][1]}", stderr=""
        ),
    )

    pages = ocr._tesseract_pages(tmp_path / "scan.pdf", "scan.pdf")

    assert [p.metadata["page_number"] for p in pages] == [1, 2]
    assert all(p.metadata["ocr_provider"] == "tesseract" for p in pages)
    assert "page-1.png" in pages[0].page_content


def test_tesseract_render_uses_pdftoppm_and_caps_pages(monkeypatch, tmp_path):
    captured = {}

    def fake_run(command, **kwargs):
        captured["command"] = command
        (tmp_path / "page-1.png").write_bytes(b"png")
        (tmp_path / "page-2.png").write_bytes(b"png")
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(settings, "ocr_max_pages", 5)
    monkeypatch.setattr(ocr.subprocess, "run", fake_run)

    images = ocr._render_pages(tmp_path / "scan.pdf", tmp_path)

    assert captured["command"][:4] == ["pdftoppm", "-r", str(settings.ocr_dpi), "-png"]
    assert captured["command"][4:8] == ["-f", "1", "-l", "5"]
    assert captured["command"][8] == str(tmp_path / "scan.pdf")
    assert [p.name for p in images] == ["page-1.png", "page-2.png"]


def test_ocr_pdf_falls_back_to_second_provider(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ocr_provider", "auto")
    monkeypatch.setattr(ocr, "available_providers", lambda: ["mistral", "tesseract"])

    def broken(path, name):
        raise RuntimeError("429 rate limited")

    def working(path, name):
        return [Document(page_content="recovered", metadata={"page": 0})]

    monkeypatch.setattr(ocr, "_mistral_pages", broken)
    monkeypatch.setattr(ocr, "_tesseract_pages", working)

    result = ocr.ocr_pdf(tmp_path / "scan.pdf", "scan.pdf")
    assert result.provider == "tesseract"
    assert result.chars == len("recovered")


def test_ocr_pdf_raises_when_all_providers_fail(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ocr_provider", "auto")
    monkeypatch.setattr(ocr, "available_providers", lambda: ["mistral"])

    def broken(path, name):
        raise RuntimeError("network down")

    monkeypatch.setattr(ocr, "_mistral_pages", broken)

    with pytest.raises(ocr.OcrUnavailable, match="network down"):
        ocr.ocr_pdf(tmp_path / "scan.pdf", "scan.pdf")


def test_ocr_pdf_raises_when_no_engine_available(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ocr_provider", "auto")
    monkeypatch.setattr(ocr, "available_providers", lambda: [])

    with pytest.raises(ocr.OcrUnavailable, match="MISTRAL_API_KEY"):
        ocr.ocr_pdf(tmp_path / "scan.pdf", "scan.pdf")


def test_describe_reports_ocr_metadata():
    assert ocr.describe([Document(page_content="a")]) == {
        "ocr_used": False,
        "ocr_provider": None,
    }
    described = ocr.describe(
        [Document(page_content="a", metadata={"ocr": True, "ocr_provider": "mistral"})]
    )
    assert described == {"ocr_used": True, "ocr_provider": "mistral"}
