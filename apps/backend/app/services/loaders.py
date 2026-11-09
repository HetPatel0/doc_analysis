"""Loaders for every supported upload format.

Uploads are normalised to LangChain ``Document`` objects here so the indexing
pipeline (chunking, embeddings, pgvector) does not care about the source format.
PDF keeps the historical PyPDF + OCR path; DOCX, TXT and Markdown become plain
text, and URL imports arrive as extracted text (``source_kind="url"``).
"""

from __future__ import annotations

import io
import logging
import re
import zipfile
from pathlib import Path

from langchain_core.documents import Document

from app import dependencies as deps

logger = logging.getLogger(__name__)

PDF = "pdf"
DOCX = "docx"
TXT = "txt"
MD = "md"
URL = "url"

SOURCE_KINDS = (PDF, DOCX, TXT, MD, URL)
TEXT_KINDS = frozenset({TXT, MD, URL})
PAGE_KINDS = frozenset({PDF})

# Extension -> canonical kind. ``.markdown`` is accepted as Markdown too.
EXTENSION_KIND = {
    ".pdf": PDF,
    ".docx": DOCX,
    ".txt": TXT,
    ".md": MD,
    ".markdown": MD,
}

CONTENT_TYPE_KIND = {
    "application/pdf": PDF,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": DOCX,
    "text/plain": TXT,
    "text/markdown": MD,
    "text/x-markdown": MD,
}

KIND_MIME_TYPE = {
    PDF: "application/pdf",
    DOCX: ("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    TXT: "text/plain; charset=utf-8",
    MD: "text/markdown; charset=utf-8",
    URL: "text/plain; charset=utf-8",
}

KIND_LABEL = {
    PDF: "PDF",
    DOCX: "DOCX",
    TXT: "TXT",
    MD: "Markdown",
    URL: "URL",
}

_EXTENSION_FOR_KIND = {
    PDF: (".pdf",),
    DOCX: (".docx",),
    TXT: (".txt",),
    MD: (".md", ".markdown"),
    URL: (".txt",),
}

_DEFAULT_NAME = "document"


def normalize_source_kind(kind: str | None) -> str:
    """Map a stored/requested kind onto the canonical set."""
    candidate = (kind or PDF).strip().lower()
    if candidate in SOURCE_KINDS:
        return candidate
    # URL imports are stored as text files; an older row might still say "pdf".
    return PDF


def loader_kind(kind: str | None) -> str:
    """Return the loader to use. URL imports are indexed as plain text."""
    normalized = normalize_source_kind(kind)
    return TXT if normalized == URL else normalized


def detect_kind(file_name: str | None, content_type: str | None) -> str | None:
    """Detect an upload kind from its extension first, then its MIME type."""
    suffix = Path(file_name or "").suffix.lower()
    if suffix in EXTENSION_KIND:
        return EXTENSION_KIND[suffix]

    mime = (content_type or "").split(";")[0].strip().lower()
    return CONTENT_TYPE_KIND.get(mime)


def mime_type_for(kind: str | None) -> str:
    return KIND_MIME_TYPE[normalize_source_kind(kind)]


def label_for(kind: str | None) -> str:
    return KIND_LABEL[normalize_source_kind(kind)]


def sanitize_file_name(raw_name: str | None, kind: str | None = PDF) -> str:
    """Keep a display-safe file name with an extension that matches ``kind``."""
    normalized = normalize_source_kind(kind)
    default = f"{_DEFAULT_NAME}{_EXTENSION_FOR_KIND[normalized][0]}"
    name = Path(raw_name or default).name.strip() or default
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._") or default

    allowed = _EXTENSION_FOR_KIND[normalized]
    if not name.lower().endswith(allowed):
        name = f"{name}{allowed[0]}"
    return name[:128]


def decode_bytes(data: bytes) -> str:
    """Decode text uploads, tolerating UTF-8 BOMs and UTF-16 exports."""
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16")
    if data.startswith(b"\xef\xbb\xbf"):
        return data.decode("utf-8-sig")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        pass
    try:
        return data.decode("utf-16")
    except UnicodeDecodeError:
        return data.decode("latin-1")


def validate_bytes(kind: str | None, data: bytes) -> None:
    """Reject files whose bytes do not match the claimed kind.

    Raises ``ValueError`` with a user-facing message; the router turns that into
    a 400. Text formats only need to decode and must not look binary.
    """
    normalized = normalize_source_kind(kind)

    if not data:
        raise ValueError("Uploaded file is empty.")

    if normalized == PDF:
        if not data.startswith(b"%PDF"):
            raise ValueError("File is not a valid PDF.")
        return

    if normalized == DOCX:
        if not data.startswith(b"PK\x03\x04"):
            raise ValueError("File is not a valid DOCX.")
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                names = set(archive.namelist())
        except zipfile.BadZipFile as exc:
            raise ValueError("File is not a valid DOCX.") from exc
        if "word/document.xml" not in names:
            raise ValueError("File is not a valid DOCX.")
        return

    if normalized in TEXT_KINDS:
        text = decode_bytes(data)
        if "\x00" in text:
            raise ValueError("File is not a valid text document.")
        if not text.strip():
            raise ValueError("Uploaded file is empty.")
        return

    raise ValueError("Unsupported file type.")


def validate_text_payload(kind: str | None, text: str) -> None:
    """Validation for text that was already decoded (URL extraction)."""
    normalized = normalize_source_kind(kind)
    if normalized not in TEXT_KINDS:
        return
    if "\x00" in text:
        raise ValueError("The extracted text is not readable.")
    if not text.strip():
        raise ValueError("Uploaded file is empty.")


def load_document(path: Path, kind: str | None) -> tuple[list[Document], int]:
    """Return ``(documents, page_count)`` for an uploaded file.

    PDF loading failures return an empty list (with ``0`` pages) so the OCR
    fallback still gets a chance; text/DOCX failures raise and mark the document
    failed with a readable error.
    """
    chosen = loader_kind(kind)

    if chosen == PDF:
        return _load_pdf(path)
    if chosen == DOCX:
        return _load_docx(path)
    if chosen in TEXT_KINDS:
        return _load_text(path)

    raise ValueError(f"Unsupported document kind: {kind}")


def _load_pdf(path: Path) -> tuple[list[Document], int]:
    PyPDFLoader, _ = deps.get_indexing_dependencies()
    try:
        pages = PyPDFLoader(str(path)).load()
    except Exception:
        # A corrupt/odd PDF can still be readable by OCR.
        return [], 0
    return [doc for doc in pages if doc.page_content.strip()], len(pages)


def _load_text(path: Path) -> tuple[list[Document], int]:
    text = decode_bytes(path.read_bytes())
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    if not normalized.strip():
        return [], 0
    # No page metadata: citations become "chunk N" for page-less formats.
    return [Document(page_content=normalized, metadata={})], 1


def _load_docx(path: Path) -> tuple[list[Document], int]:
    from docx import Document as DocxDocument

    try:
        document = DocxDocument(str(path))
    except Exception as exc:
        raise ValueError("Could not read the DOCX file.") from exc

    blocks: list[str] = []
    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if text:
            blocks.append(text)

    # Tables often carry the important numbers in reports; flatten each row.
    for table in document.tables:
        for row in table.rows:
            cells = [" ".join(cell.text.split()) for cell in row.cells]
            if any(cells):
                blocks.append(" | ".join(cells))

    text = "\n\n".join(blocks)
    if not text.strip():
        return [], 0
    return [Document(page_content=text, metadata={})], 1
