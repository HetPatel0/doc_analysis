from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

from fastapi import HTTPException

from app import dependencies as deps
from app.config import settings
from app.observability import capture_exception
from app.schemas import DocumentStatusResponse
from app.services import insights, ocr, retrieval


def get_vectorstore_path(document_id: str) -> Path:
    return settings.vectorstores_dir / document_id


def get_document_status_path(document_id: str) -> Path:
    return settings.vectorstores_dir / f"{document_id}.json"


def sanitize_file_name(raw_name: str | None) -> str:
    name = Path(raw_name or "document.pdf").name.strip() or "document.pdf"
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._") or "document.pdf"
    if not name.lower().endswith(".pdf"):
        name = f"{name}.pdf"
    return name[:128]


def write_document_status(
    document_id: str,
    *,
    file_name: str,
    status: str,
    chunks_indexed: int | None = None,
    error: str | None = None,
    summary: str | None = None,
    key_points: list[str] | None = None,
    action_items: list[str] | None = None,
    quiz: list[dict[str, str]] | None = None,
    ocr_used: bool = False,
    ocr_provider: str | None = None,
) -> None:
    get_document_status_path(document_id).write_text(
        json.dumps(
            {
                "document_id": document_id,
                "file_name": file_name,
                "status": status,
                "chunks_indexed": chunks_indexed,
                "error": error,
                "summary": summary,
                "key_points": key_points or [],
                "action_items": action_items or [],
                "quiz": quiz or [],
                "ocr_used": ocr_used,
                "ocr_provider": ocr_provider,
            }
        ),
        encoding="utf-8",
    )


def find_uploaded_file(document_id: str) -> Path | None:
    for upload_path in settings.uploads_dir.glob(f"{document_id}-*"):
        if upload_path.is_file():
            return upload_path
    return None


def read_document_status(document_id: str) -> DocumentStatusResponse:
    status_path = get_document_status_path(document_id)
    if not status_path.exists():
        raise HTTPException(status_code=404, detail="Document not found.")
    return DocumentStatusResponse.model_validate_json(
        status_path.read_text(encoding="utf-8")
    )


def ensure_document_exists(document_id: str) -> Path:
    status = read_document_status(document_id)
    if status.status == "failed":
        raise HTTPException(
            status_code=400, detail=status.error or "Document indexing failed."
        )
    if status.status != "ready":
        raise HTTPException(
            status_code=409, detail="Document is still being indexed."
        )

    vectorstore_path = get_vectorstore_path(document_id)
    if not vectorstore_path.exists():
        raise HTTPException(status_code=404, detail="Document index not found.")
    return vectorstore_path


def delete_document_files(document_id: str) -> None:
    shutil.rmtree(get_vectorstore_path(document_id), ignore_errors=True)
    status_path = get_document_status_path(document_id)
    if status_path.exists():
        status_path.unlink()
    for upload_path in settings.uploads_dir.glob(f"{document_id}-*"):
        if upload_path.is_file():
            upload_path.unlink()


def _load_text_pages(upload_path: Path) -> tuple[list, int]:
    """Return pages that have a text layer plus the total page count."""
    PyPDFLoader, _, _ = deps.get_indexing_dependencies()
    try:
        pages = PyPDFLoader(str(upload_path)).load()
    except Exception:
        # A corrupt/odd PDF can still be readable by OCR.
        return [], 0
    return [doc for doc in pages if doc.page_content.strip()], len(pages)


def index_pdf(document_id: str, file_name: str, upload_path: Path) -> None:
    write_document_status(document_id, file_name=file_name, status="indexing")

    try:
        _, Chroma, RecursiveCharacterTextSplitter = deps.get_indexing_dependencies()

        docs, page_count = _load_text_pages(upload_path)
        ocr_used = False
        ocr_provider = None

        if settings.ocr_provider != "off" and ocr.needs_ocr(docs, page_count):
            result = ocr.ocr_pdf(upload_path, file_name)
            if result.chars > sum(len(doc.page_content.strip()) for doc in docs):
                docs = result.documents
                ocr_used = True
                ocr_provider = result.provider

        if not docs:
            raise ValueError("The PDF did not contain readable pages.")

        splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
            chunk_size=settings.chunk_size,
            chunk_overlap=settings.chunk_overlap,
            add_start_index=True,
            separators=["\n\n", "\n", ". ", " ", ""],
        )
        chunks = [
            chunk
            for chunk in splitter.split_documents(docs)
            if len(chunk.page_content.strip()) >= settings.min_chunk_chars
        ]

        if not chunks:
            raise ValueError("The PDF did not contain enough readable text to index.")

        for chunk_index, chunk in enumerate(chunks):
            page_number = retrieval.normalize_page_number(chunk.metadata)
            chunk.metadata.update(
                {
                    "document_id": document_id,
                    "file_name": file_name,
                    "chunk_index": chunk_index,
                    "page_number": page_number,
                    "source_label": retrieval.source_label(
                        {**chunk.metadata, "chunk_index": chunk_index}
                    ),
                }
            )

        Chroma.from_documents(
            documents=chunks,
            embedding=deps.get_embedding_model(),
            persist_directory=str(get_vectorstore_path(document_id)),
        )

        document_insights = insights.generate_insights(chunks)

        write_document_status(
            document_id,
            file_name=file_name,
            status="ready",
            chunks_indexed=len(chunks),
            ocr_used=ocr_used,
            ocr_provider=ocr_provider,
            **document_insights,
        )
    except Exception as exc:
        capture_exception(exc)
        write_document_status(
            document_id,
            file_name=file_name,
            status="failed",
            error=str(exc),
        )
