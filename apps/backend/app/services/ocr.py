"""OCR fallback for PDFs without a usable text layer.

`PyPDFLoader` returns empty (or near-empty) pages for scanned documents, which
used to fail indexing outright. This module turns those pages into text using,
in order:

1. local `tesseract` + `pdftoppm` when those binaries are installed (free)
2. Mistral OCR (`mistral-ocr-latest`) when an API key is configured
3. a descriptive error so the document fails with an actionable message

`OCR_PROVIDER=off` disables the fallback; `mistral` / `tesseract` force a single
provider. Provider choice is per-document, at indexing time. `auto` prefers the
free local engine and only calls the paid API when the binaries are missing or
the local attempt yields no text.
"""

from __future__ import annotations

import base64
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from langchain_core.documents import Document

from app.config import settings

MISTRAL_PROVIDER = "mistral"
TESSERACT_PROVIDER = "tesseract"


class OcrUnavailable(RuntimeError):
    """No OCR engine could be used for this document."""


@dataclass
class OcrResult:
    documents: list[Document]
    provider: str

    @property
    def chars(self) -> int:
        return sum(len(doc.page_content.strip()) for doc in self.documents)


def needs_ocr(documents: list[Document], page_count: int) -> bool:
    """True when the extracted text layer is too thin to be a real document."""
    if page_count <= 0:
        return True

    min_chars = settings.ocr_min_chars_per_page * page_count
    return sum(len(doc.page_content.strip()) for doc in documents) < min_chars


def available_providers() -> list[str]:
    """Providers usable right now, cheapest first."""
    providers: list[str] = []
    if shutil.which("pdftoppm") and shutil.which("tesseract"):
        providers.append(TESSERACT_PROVIDER)
    if settings.mistral_api_key:
        providers.append(MISTRAL_PROVIDER)
    return providers


def _provider_chain() -> list[str]:
    configured = settings.ocr_provider.strip().lower()
    if configured == "off":
        return []
    if configured in {MISTRAL_PROVIDER, TESSERACT_PROVIDER}:
        if configured not in available_providers():
            raise OcrUnavailable(
                f"OCR_PROVIDER={configured} but that engine is not available. "
                "Mistral OCR needs MISTRAL_API_KEY; tesseract needs the "
                "tesseract and poppler-utils system packages."
            )
        return [configured]
    return available_providers()


def _document(page_index: int, text: str, provider: str, file_name: str) -> Document:
    return Document(
        page_content=text.strip(),
        metadata={
            "source": file_name,
            "page": page_index,
            "page_number": page_index + 1,
            "ocr": True,
            "ocr_provider": provider,
        },
    )


def _mistral_pages(pdf_path: Path, file_name: str) -> list[Document]:
    from mistralai.client import Mistral

    encoded = base64.b64encode(pdf_path.read_bytes()).decode("ascii")
    client = Mistral(api_key=settings.mistral_api_key)
    response = client.ocr.process(
        model=settings.ocr_model,
        document={
            "type": "document_url",
            "document_url": f"data:application/pdf;base64,{encoded}",
        },
        timeout_ms=settings.ocr_timeout_seconds * 1000,
    )

    documents = [
        _document(page.index, page.markdown, MISTRAL_PROVIDER, file_name)
        for page in response.pages[: settings.ocr_max_pages]
    ]
    return [doc for doc in documents if doc.page_content]


def _render_pages(pdf_path: Path, workdir: Path) -> list[Path]:
    subprocess.run(
        [
            "pdftoppm",
            "-r",
            str(settings.ocr_dpi),
            "-png",
            "-f",
            "1",
            "-l",
            str(settings.ocr_max_pages),
            str(pdf_path),
            str(workdir / "page"),
        ],
        check=True,
        capture_output=True,
        timeout=settings.ocr_timeout_seconds,
    )
    return sorted(workdir.glob("page*.png"))


def _tesseract_pages(pdf_path: Path, file_name: str) -> list[Document]:
    documents: list[Document] = []

    with tempfile.TemporaryDirectory(prefix="bookify-ocr-") as tmp:
        for index, image_path in enumerate(_render_pages(pdf_path, Path(tmp))):
            result = subprocess.run(
                [
                    "tesseract",
                    str(image_path),
                    "stdout",
                    "-l",
                    settings.ocr_lang,
                    "--psm",
                    "3",
                ],
                check=True,
                capture_output=True,
                text=True,
                timeout=settings.ocr_timeout_seconds,
            )
            document = _document(index, result.stdout, TESSERACT_PROVIDER, file_name)
            if document.page_content:
                documents.append(document)

    return documents


def ocr_pdf(pdf_path: Path, file_name: str) -> OcrResult:
    """Run OCR with the first provider that returns text, else raise."""
    chain = _provider_chain()
    if not chain:
        raise OcrUnavailable(
            "This PDF looks like a scan, but OCR is disabled or no OCR engine "
            "is installed. Set MISTRAL_API_KEY (or OCR_PROVIDER=tesseract with "
            "tesseract + poppler-utils installed) and re-upload."
        )

    errors: list[str] = []
    for provider in chain:
        try:
            documents = (
                _mistral_pages(pdf_path, file_name)
                if provider == MISTRAL_PROVIDER
                else _tesseract_pages(pdf_path, file_name)
            )
        except Exception as exc:  # provider-specific failure: try the next one
            errors.append(f"{provider}: {exc}")
            continue

        result = OcrResult(documents=documents, provider=provider)
        if result.chars:
            return result
        errors.append(f"{provider}: returned no text")

    raise OcrUnavailable(
        "OCR could not read this PDF. " + "; ".join(errors)
        if errors
        else "OCR could not read this PDF."
    )


def describe(documents: list[Document]) -> dict[str, Any]:
    """Small metadata blob for logs/status."""
    providers = {
        doc.metadata.get("ocr_provider")
        for doc in documents
        if doc.metadata.get("ocr")
    }
    return {
        "ocr_used": bool(providers),
        "ocr_provider": next(iter(providers)) if providers else None,
    }
