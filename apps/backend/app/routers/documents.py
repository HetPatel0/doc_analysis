from __future__ import annotations

from urllib.parse import urlparse
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.config import settings
from app.schemas import DocumentStatusResponse, UrlImportRequest
from app.security import require_backend_auth
from app.services import documents, loaders, url_import

router = APIRouter(tags=["documents"])


@router.get(
    "/documents/{document_id}/file", dependencies=[Depends(require_backend_auth)]
)
def get_document_file(document_id: str) -> FileResponse:
    status = documents.read_document_status(document_id)
    upload_path = documents.find_uploaded_file(document_id)
    if upload_path is None:
        raise HTTPException(status_code=404, detail="Document file not found.")

    media_type = status.mime_type or loaders.mime_type_for(status.source_kind)
    return FileResponse(
        upload_path,
        media_type=media_type,
        headers={
            "Content-Disposition": f'inline; filename="{status.file_name}"',
            "Cache-Control": "private, max-age=3600",
        },
    )


@router.get(
    "/documents/{document_id}/chunks", dependencies=[Depends(require_backend_auth)]
)
def get_document_chunks(document_id: str) -> dict[str, list[dict]]:
    """Chunk positions so the text reader can jump to a citation."""
    documents.read_document_status(document_id)  # 404 if unknown
    return {"chunks": documents.list_document_chunks(document_id)}


@router.post(
    "/documents/{document_id}/retry", dependencies=[Depends(require_backend_auth)]
)
def retry_document(
    document_id: str, background_tasks: BackgroundTasks
) -> dict[str, str]:
    """Re-run indexing for a failed or orphaned document."""
    status = documents.read_document_status(document_id)
    if status.status == "ready":
        raise HTTPException(status_code=409, detail="Document is already indexed.")
    if status.status in {"queued", "indexing"} and not status.stalled:
        raise HTTPException(
            status_code=409, detail="Indexing is already in progress."
        )

    upload_path = documents.find_uploaded_file(document_id)
    if upload_path is None:
        raise HTTPException(status_code=404, detail="Document file not found.")

    documents.write_document_status(
        document_id,
        file_name=status.file_name,
        status="queued",
        source_kind=status.source_kind,
        mime_type=status.mime_type,
    )
    background_tasks.add_task(
        documents.index_document,
        document_id,
        status.file_name,
        upload_path,
        status.source_kind,
        status.mime_type,
    )
    return {"document_id": document_id, "status": "queued"}


@router.get(
    "/documents/{document_id}",
    response_model=DocumentStatusResponse,
    dependencies=[Depends(require_backend_auth)],
)
def get_document_status(document_id: str) -> DocumentStatusResponse:
    return documents.read_document_status(document_id)


@router.delete(
    "/documents/{document_id}", dependencies=[Depends(require_backend_auth)]
)
def delete_document(document_id: str) -> dict[str, str]:
    documents.read_document_status(document_id)  # 404 if unknown
    documents.delete_document_files(document_id)
    return {"document_id": document_id, "status": "deleted"}


@router.post("/upload", dependencies=[Depends(require_backend_auth)])
async def upload_document(
    background_tasks: BackgroundTasks, file: UploadFile = File(...)
) -> dict[str, str | int]:
    kind = loaders.detect_kind(file.filename, file.content_type)
    if kind is None:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Upload a PDF, DOCX, TXT, or Markdown file.",
        )

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(file_bytes) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=413,
            detail=(
                f"{loaders.label_for(kind)} exceeds the "
                f"{settings.max_upload_mb}MB limit."
            ),
        )
    try:
        loaders.validate_bytes(kind, file_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    document_id = str(uuid4())
    safe_name = documents.sanitize_file_name(file.filename, kind)
    upload_path = settings.uploads_dir / f"{document_id}-{safe_name}"
    mime_type = loaders.mime_type_for(kind)

    upload_path.write_bytes(file_bytes)
    documents.write_document_status(
        document_id,
        file_name=safe_name,
        status="queued",
        source_kind=kind,
        mime_type=mime_type,
    )
    background_tasks.add_task(
        documents.index_document,
        document_id,
        safe_name,
        upload_path,
        kind,
        mime_type,
    )

    return {
        "document_id": document_id,
        "file_name": safe_name,
        "status": "queued",
        "source_kind": kind,
        "mime_type": mime_type,
    }


@router.post("/import/url", dependencies=[Depends(require_backend_auth)])
def import_document_from_url(
    payload: UrlImportRequest, background_tasks: BackgroundTasks
) -> dict[str, str | int]:
    try:
        result = url_import.import_url(payload.url)
    except url_import.UrlImportError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    document_id = str(uuid4())
    base_name = result.title or urlparse(result.final_url).netloc or "imported-page"
    safe_name = documents.sanitize_file_name(f"{base_name}.txt", loaders.TXT)
    upload_path = settings.uploads_dir / f"{document_id}-{safe_name}"
    mime_type = loaders.mime_type_for(loaders.URL)

    upload_path.write_text(result.text, encoding="utf-8")
    documents.write_document_status(
        document_id,
        file_name=safe_name,
        status="queued",
        source_kind=loaders.URL,
        mime_type=mime_type,
    )
    background_tasks.add_task(
        documents.index_document,
        document_id,
        safe_name,
        upload_path,
        loaders.URL,
        mime_type,
    )

    return {
        "document_id": document_id,
        "file_name": safe_name,
        "status": "queued",
        "source_kind": loaders.URL,
        "source_url": result.final_url,
        "mime_type": mime_type,
    }
