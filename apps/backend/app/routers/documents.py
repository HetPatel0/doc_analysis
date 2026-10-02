from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile

from app.config import settings
from app.schemas import DocumentStatusResponse
from app.security import require_backend_auth
from app.services import documents

router = APIRouter(tags=["documents"])


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
async def upload_pdf(
    background_tasks: BackgroundTasks, file: UploadFile = File(...)
) -> dict[str, str | int]:
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(file_bytes) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"PDF exceeds the {settings.max_upload_mb}MB limit.",
        )
    if file_bytes[:4] != b"%PDF":
        raise HTTPException(status_code=400, detail="File is not a valid PDF.")

    document_id = str(uuid4())
    safe_name = documents.sanitize_file_name(file.filename)
    upload_path = settings.uploads_dir / f"{document_id}-{safe_name}"

    upload_path.write_bytes(file_bytes)
    documents.write_document_status(
        document_id, file_name=safe_name, status="queued"
    )
    background_tasks.add_task(
        documents.index_pdf, document_id, safe_name, upload_path
    )

    return {
        "document_id": document_id,
        "file_name": safe_name,
        "status": "queued",
    }
