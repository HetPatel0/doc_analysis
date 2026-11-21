from __future__ import annotations

import asyncio
import logging
import shutil
import threading
import time
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi import HTTPException

from app import dependencies as deps
from app.config import settings
from app.observability import capture_exception
from app.schemas import DocumentStatusResponse
from app.services import chunking, insights, loaders, ocr, retrieval
from app.services.store import get_store

logger = logging.getLogger(__name__)

# document_id -> monotonic timestamp. Guards the tiny window between scheduling
# an indexing task and its first status write, plus mid-index deletes.
_deleted_documents: dict[str, float] = {}
_deleted_documents_lock = threading.Lock()
_TOMBSTONE_TTL_SECONDS = 24 * 60 * 60

# Track active indexing tasks in this process so the watchdog does not
# attempt to recover documents that are actively being indexed.
_active_indexing: set[str] = set()
_active_indexing_lock = threading.Lock()


def is_indexing_active(document_id: str) -> bool:
    with _active_indexing_lock:
        return document_id in _active_indexing


@contextmanager
def track_indexing(document_id: str):
    with _active_indexing_lock:
        _active_indexing.add(document_id)
    try:
        yield
    finally:
        with _active_indexing_lock:
            _active_indexing.discard(document_id)


def get_legacy_vectorstore_path(document_id: str) -> Path:
    """Pre-3.1 Chroma directory, kept only so deletes can clean up old data."""
    return settings.vectorstores_dir / document_id


def sanitize_file_name(raw_name: str | None, kind: str = loaders.PDF) -> str:
    """Keep the historical entry point; formatting lives in ``loaders``."""
    return loaders.sanitize_file_name(raw_name, kind)


def write_document_status(
    document_id: str,
    *,
    file_name: str,
    status: str,
    source_kind: str = loaders.PDF,
    mime_type: str | None = None,
    chunks_indexed: int | None = None,
    error: str | None = None,
    summary: str | None = None,
    key_points: list[str] | None = None,
    action_items: list[str] | None = None,
    quiz: list[dict[str, str]] | None = None,
    ocr_used: bool = False,
    ocr_provider: str | None = None,
    insights_status: str = "pending",
    index_attempts: int | None = None,
) -> None:
    get_store().write_status(
        document_id,
        file_name=file_name,
        status=status,
        source_kind=source_kind,
        mime_type=mime_type or loaders.mime_type_for(source_kind),
        chunks_indexed=chunks_indexed,
        error=error,
        summary=summary,
        key_points=key_points,
        action_items=action_items,
        quiz=quiz,
        ocr_used=ocr_used,
        ocr_provider=ocr_provider,
        insights_status=insights_status,
        index_attempts=index_attempts,
    )


def find_uploaded_file(document_id: str) -> Path | None:
    for upload_path in settings.uploads_dir.glob(f"{document_id}-*"):
        if upload_path.is_file():
            return upload_path
    return None


def read_document_status(document_id: str) -> DocumentStatusResponse:
    record = get_store().read_status(document_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Document not found.")

    updated_at = record.get("updated_at")
    stalled = False
    if record.get("status") in {"queued", "indexing"} and updated_at:
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=UTC)
        age = (datetime.now(UTC) - updated_at).total_seconds()
        stalled = age > settings.index_stale_seconds

    return DocumentStatusResponse.model_validate({**record, "stalled": stalled})


def ensure_document_exists(document_id: str) -> None:
    status = read_document_status(document_id)
    if status.status == "failed":
        raise HTTPException(
            status_code=400, detail=status.error or "Document indexing failed."
        )
    if status.status != "ready":
        raise HTTPException(
            status_code=409, detail="Document is still being indexed."
        )

    if get_store().count_chunks(document_id) == 0:
        raise HTTPException(status_code=404, detail="Document index not found.")


def delete_document_files(document_id: str) -> None:
    _remember_deleted(document_id)
    get_store().delete_document(document_id)
    shutil.rmtree(get_legacy_vectorstore_path(document_id), ignore_errors=True)
    legacy_status = settings.vectorstores_dir / f"{document_id}.json"
    if legacy_status.exists():
        legacy_status.unlink()
    for upload_path in settings.uploads_dir.glob(f"{document_id}-*"):
        if upload_path.is_file():
            upload_path.unlink()


def list_document_chunks(document_id: str) -> list[dict]:
    """Chunk positions for the text reader's citation anchors."""
    return get_store().list_chunks(document_id)


def _load_text_pages(upload_path: Path) -> tuple[list, int]:
    """Return the PDF text layer; kept for callers/tests that import it."""
    return loaders.load_document(upload_path, loaders.PDF)


def _embed_chunks(texts: list[str]) -> list[list[float]]:
    embedding_model = deps.get_embedding_model()
    batch_size = max(1, settings.embedding_batch_size)
    vectors: list[list[float]] = []
    for start in range(0, len(texts), batch_size):
        vectors.extend(embedding_model.embed_documents(texts[start : start + batch_size]))
    if len(vectors) != len(texts):
        raise ValueError(
            f"expected {len(texts)} embeddings, the provider returned {len(vectors)}"
        )
    return vectors


def _remember_deleted(document_id: str) -> None:
    """Remember a deletion so an in-flight indexing task cannot resurrect it.

    Indexing runs as a FastAPI background task in this same process, so an
    in-memory tombstone is enough for the initial write. The DB check in
    ``_document_was_deleted`` covers the rest if the deletion lands mid-index.
    """
    now = time.monotonic()
    with _deleted_documents_lock:
        _deleted_documents[document_id] = now
        cutoff = now - _TOMBSTONE_TTL_SECONDS
        for key, seen in list(_deleted_documents.items()):
            if seen < cutoff:
                del _deleted_documents[key]


def _recently_deleted(document_id: str) -> bool:
    with _deleted_documents_lock:
        return document_id in _deleted_documents


def _document_was_deleted(document_id: str) -> bool:
    """True when the status row vanished while indexing was running.

    Deletes can land mid-indexing; without this check the final status write
    would resurrect the row and leave orphan chunks behind.
    """
    if _recently_deleted(document_id):
        return True
    try:
        return get_store().read_status(document_id) is None
    except Exception:
        # Never let bookkeeping hide a real indexing error.
        return False


def index_document(
    document_id: str,
    file_name: str,
    upload_path: Path,
    source_kind: str = loaders.PDF,
    mime_type: str | None = None,
) -> None:
    """Index one uploaded document, whatever its format."""
    if _recently_deleted(document_id):
        return

    with track_indexing(document_id):
        _index_document(document_id, file_name, upload_path, source_kind, mime_type)


def _index_document(
    document_id: str,
    file_name: str,
    upload_path: Path,
    source_kind: str = loaders.PDF,
    mime_type: str | None = None,
) -> None:
    kind = loaders.normalize_source_kind(source_kind)
    mime = mime_type or loaders.mime_type_for(kind)
    started = time.perf_counter()
    write_document_status(
        document_id,
        file_name=file_name,
        status="indexing",
        source_kind=kind,
        mime_type=mime,
    )

    load_seconds = ocr_seconds = chunk_seconds = 0.0
    embed_seconds = store_seconds = 0.0
    chunks: list = []
    ocr_used = False
    ocr_provider: str | None = None
    is_pdf = loaders.loader_kind(kind) == loaders.PDF

    try:
        step = time.perf_counter()
        docs, page_count = loaders.load_document(upload_path, kind)
        load_seconds = time.perf_counter() - step

        if (
            is_pdf
            and settings.ocr_provider != "off"
            and ocr.needs_ocr(docs, page_count)
        ):
            step = time.perf_counter()
            result = ocr.ocr_pdf(upload_path, file_name)
            ocr_seconds = time.perf_counter() - step
            if result.chars > sum(len(doc.page_content.strip()) for doc in docs):
                docs = result.documents
                ocr_used = True
                ocr_provider = result.provider

        if not docs:
            if is_pdf:
                raise ValueError("The PDF did not contain readable pages.")
            raise ValueError("The document did not contain readable text.")

        step = time.perf_counter()
        chunks = chunking.split_documents(docs)
        chunk_seconds = time.perf_counter() - step

        if not chunks:
            if is_pdf:
                raise ValueError(
                    "The PDF did not contain enough readable text to index."
                )
            raise ValueError(
                "The document did not contain enough readable text to index."
            )

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

        step = time.perf_counter()
        embeddings = _embed_chunks([chunk.page_content for chunk in chunks])
        embed_seconds = time.perf_counter() - step

        step = time.perf_counter()
        get_store().replace_chunks(document_id, chunks, embeddings)
        store_seconds = time.perf_counter() - step

        # Chunks are searchable as soon as they are stored. Insights are a
        # second LLM call and must not hold chat (or the preview) hostage, so
        # mark the document ready now and patch the insights in afterwards.
        if _document_was_deleted(document_id):
            get_store().delete_document(document_id)
            return
        write_document_status(
            document_id,
            file_name=file_name,
            status="ready",
            source_kind=kind,
            mime_type=mime,
            chunks_indexed=len(chunks),
            ocr_used=ocr_used,
            ocr_provider=ocr_provider,
        )
    except Exception as exc:
        capture_exception(exc)
        if _document_was_deleted(document_id):
            get_store().delete_document(document_id)
            return
        write_document_status(
            document_id,
            file_name=file_name,
            status="failed",
            source_kind=kind,
            mime_type=mime,
            error=str(exc),
            insights_status="unavailable",
        )
        logger.info(
            "index %s failed in %.2fs after load=%.2fs ocr=%.2fs chunk=%.2fs "
            "embed=%.2fs store=%.2fs: %s",
            document_id,
            time.perf_counter() - started,
            load_seconds,
            ocr_seconds,
            chunk_seconds,
            embed_seconds,
            store_seconds,
            exc,
        )
        return

    # Best-effort enrichment. A failure here (including the status patch) must
    # never turn a searchable document into a failed one.
    insights_seconds = 0.0
    step = time.perf_counter()
    try:
        document_insights = insights.generate_insights(chunks)
    except Exception as exc:
        capture_exception(exc)
        document_insights = dict(insights.EMPTY_INSIGHTS)
    insights_seconds = time.perf_counter() - step

    has_insights = any(
        document_insights.get(key)
        for key in ("summary", "key_points", "action_items", "quiz")
    )
    if _document_was_deleted(document_id):
        get_store().delete_document(document_id)
        return
    try:
        write_document_status(
            document_id,
            file_name=file_name,
            status="ready",
            source_kind=kind,
            mime_type=mime,
            chunks_indexed=len(chunks),
            ocr_used=ocr_used,
            ocr_provider=ocr_provider,
            insights_status="ready" if has_insights else "unavailable",
            **document_insights,
        )
    except Exception as exc:
        capture_exception(exc)

    logger.info(
        "index %s ready in %.2fs (load=%.2fs ocr=%.2fs chunk=%.2fs embed=%.2fs "
        "store=%.2fs insights=%.2fs, chunks=%d, ocr=%s)",
        document_id,
        time.perf_counter() - started,
        load_seconds,
        ocr_seconds,
        chunk_seconds,
        embed_seconds,
        store_seconds,
        insights_seconds,
        len(chunks),
        ocr_provider or "no",
    )


def index_pdf(document_id: str, file_name: str, upload_path: Path) -> None:
    """Backwards-compatible PDF entry point used by scripts and old callers."""
    index_document(
        document_id,
        file_name,
        upload_path,
        loaders.PDF,
        loaders.mime_type_for(loaders.PDF),
    )


INDEX_WATCHDOG_LOCK_ID = 829471923


def recover_stalled_documents() -> list[str]:
    """Find queued/indexing documents older than index_stale_seconds and retry them.

    Guards:
    1. Postgres advisory lock: only one backend instance runs recovery.
    2. Active tasks: documents currently indexing in this process are skipped.
    3. Deleted tombstones: recently deleted documents are skipped.
    4. Max attempts: documents exceeding index_max_attempts are marked failed.
    5. Missing file: if the uploaded file is gone from disk, marked failed.
    """
    store = get_store()
    recovered: list[str] = []

    with store.advisory_lock(INDEX_WATCHDOG_LOCK_ID) as acquired:
        if not acquired:
            return recovered

        cutoff = datetime.now(UTC) - timedelta(seconds=settings.index_stale_seconds)
        stalled_list = store.list_stalled(cutoff)
        for item in stalled_list:
            doc_id = item["document_id"]
            if is_indexing_active(doc_id) or _recently_deleted(doc_id):
                continue

            attempts = int(item.get("index_attempts") or 0)
            file_name = item.get("file_name", "document")
            source_kind = item.get("source_kind", loaders.PDF)
            mime_type = item.get("mime_type", loaders.mime_type_for(source_kind))

            if attempts >= settings.index_max_attempts:
                logger.warning(
                    "stalled document %s exceeded max attempts (%d); marking failed",
                    doc_id,
                    settings.index_max_attempts,
                )
                write_document_status(
                    doc_id,
                    file_name=file_name,
                    status="failed",
                    source_kind=source_kind,
                    mime_type=mime_type,
                    error=f"Indexing stalled and exceeded maximum retry attempts ({settings.index_max_attempts}).",
                    insights_status="unavailable",
                    index_attempts=attempts,
                )
                continue

            upload_path = find_uploaded_file(doc_id)
            if not upload_path or not upload_path.is_file():
                logger.warning(
                    "stalled document %s file not found on disk; marking failed",
                    doc_id,
                )
                write_document_status(
                    doc_id,
                    file_name=file_name,
                    status="failed",
                    source_kind=source_kind,
                    mime_type=mime_type,
                    error="Uploaded document file could not be found for retry.",
                    insights_status="unavailable",
                    index_attempts=attempts,
                )
                continue

            attempts += 1
            logger.info(
                "recovering stalled document %s (attempt %d/%d)",
                doc_id,
                attempts,
                settings.index_max_attempts,
            )
            write_document_status(
                doc_id,
                file_name=file_name,
                status="queued",
                source_kind=source_kind,
                mime_type=mime_type,
                index_attempts=attempts,
            )
            threading.Thread(
                target=index_document,
                args=(doc_id, file_name, upload_path, source_kind, mime_type),
                daemon=True,
            ).start()
            recovered.append(doc_id)

    return recovered


async def watchdog_loop() -> None:
    logger.info(
        "starting indexing watchdog (interval=%ss, stale=%ss, max_attempts=%d)",
        settings.index_watchdog_interval_seconds,
        settings.index_stale_seconds,
        settings.index_max_attempts,
    )
    while True:
        try:
            await asyncio.sleep(settings.index_watchdog_interval_seconds)
            await asyncio.to_thread(recover_stalled_documents)
        except asyncio.CancelledError:
            break
        except Exception as exc:
            capture_exception(exc)
            logger.exception("indexing watchdog iteration failed: %s", exc)
