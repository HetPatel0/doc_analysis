"""Durable RAG storage: document status + chunks/embeddings.

Phase 3.1 replaces per-document Chroma directories on the Railway volume with
Postgres + pgvector on Neon. Two tables are owned by the backend:

``document_index``
    One row per document: the status the API serves (queued/indexing/ready/
    failed), indexed chunk count, error, and the upload-time insights.

``document_chunk``
    One row per chunk: text, page, source label and a ``vector(1024)`` embedding
    (Mistral ``mistral-embed``). Similarity search orders by cosine distance.

The schema is created lazily and idempotently, so a fresh Neon database works
without a separate migration step. ``MemoryStore`` exists so the offline test
suite can exercise the same interface without a database.
"""

from __future__ import annotations

import json
import math
import threading
from collections import defaultdict
from typing import Any, Protocol

from langchain_core.documents import Document

from app.config import settings

STATUS_FIELDS = (
    "document_id",
    "file_name",
    "status",
    "chunks_indexed",
    "error",
    "summary",
    "key_points",
    "action_items",
    "quiz",
    "ocr_used",
    "ocr_provider",
)


class Store(Protocol):
    """Storage interface shared by the Postgres and in-memory implementations."""

    def write_status(
        self,
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
    ) -> None: ...

    def read_status(self, document_id: str) -> dict[str, Any] | None: ...

    def replace_chunks(
        self,
        document_id: str,
        chunks: list[Document],
        embeddings: list[list[float]],
    ) -> None: ...

    def similarity_search(
        self, document_id: str, query_embedding: list[float], k: int
    ) -> list[Document]: ...

    def count_chunks(self, document_id: str) -> int: ...

    def delete_document(self, document_id: str) -> None: ...


def _status_row(
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
) -> dict[str, Any]:
    return {
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


class PostgresStore:
    """pgvector-backed store used in production and by the eval harness."""

    def __init__(self, database_url: str, embedding_dim: int) -> None:
        self._url = database_url
        self._embedding_dim = embedding_dim
        self._schema_ready = False
        self._lock = threading.Lock()

    # -- connection / schema -------------------------------------------------

    def _connect(self, *, register: bool = True):
        import psycopg

        # Neon's pooled endpoint runs PgBouncer in transaction mode, which is
        # incompatible with psycopg's server-side prepared statements.
        conn = psycopg.connect(
            self._url, prepare_threshold=None, connect_timeout=15
        )
        if register:
            from pgvector.psycopg import register_vector

            register_vector(conn)
        return conn

    def ensure_schema(self) -> None:
        if self._schema_ready:
            return
        with self._lock:
            if self._schema_ready:
                return
            dim = int(self._embedding_dim)
            # The extension must exist before pgvector's adapter can register.
            with self._connect(register=False) as conn, conn.cursor() as cur:
                cur.execute("create extension if not exists vector")
                cur.execute(
                    """
                    create table if not exists document_index (
                        document_id text primary key,
                        file_name text not null,
                        status text not null,
                        chunks_indexed integer,
                        error text,
                        summary text,
                        key_points jsonb not null default '[]'::jsonb,
                        action_items jsonb not null default '[]'::jsonb,
                        quiz jsonb not null default '[]'::jsonb,
                        ocr_used boolean not null default false,
                        ocr_provider text,
                        updated_at timestamptz not null default now()
                    )
                    """
                )
                cur.execute(
                    f"""
                    create table if not exists document_chunk (
                        id bigserial primary key,
                        document_id text not null,
                        chunk_index integer not null,
                        page_number integer,
                        source_label text not null,
                        content text not null,
                        embedding vector({dim}) not null,
                        unique (document_id, chunk_index)
                    )
                    """
                )
                cur.execute(
                    """
                    create index if not exists document_chunk_document_idx
                        on document_chunk (document_id)
                    """
                )
                cur.execute(
                    """
                    create index if not exists document_chunk_embedding_idx
                        on document_chunk using hnsw (embedding vector_cosine_ops)
                    """
                )
            self._schema_ready = True

    # -- status --------------------------------------------------------------

    def write_status(
        self,
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
        self.ensure_schema()
        row = _status_row(
            document_id,
            file_name=file_name,
            status=status,
            chunks_indexed=chunks_indexed,
            error=error,
            summary=summary,
            key_points=key_points,
            action_items=action_items,
            quiz=quiz,
            ocr_used=ocr_used,
            ocr_provider=ocr_provider,
        )
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                insert into document_index (
                    document_id, file_name, status, chunks_indexed, error, summary,
                    key_points, action_items, quiz, ocr_used, ocr_provider, updated_at
                ) values (
                    %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s, %s, now()
                )
                on conflict (document_id) do update set
                    file_name = excluded.file_name,
                    status = excluded.status,
                    chunks_indexed = excluded.chunks_indexed,
                    error = excluded.error,
                    summary = excluded.summary,
                    key_points = excluded.key_points,
                    action_items = excluded.action_items,
                    quiz = excluded.quiz,
                    ocr_used = excluded.ocr_used,
                    ocr_provider = excluded.ocr_provider,
                    updated_at = now()
                """,
                (
                    document_id,
                    row["file_name"],
                    row["status"],
                    row["chunks_indexed"],
                    row["error"],
                    row["summary"],
                    json.dumps(row["key_points"]),
                    json.dumps(row["action_items"]),
                    json.dumps(row["quiz"]),
                    row["ocr_used"],
                    row["ocr_provider"],
                ),
            )

    def read_status(self, document_id: str) -> dict[str, Any] | None:
        self.ensure_schema()
        from psycopg.rows import dict_row

        with self._connect() as conn, conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                select document_id, file_name, status, chunks_indexed, error,
                       summary, key_points, action_items, quiz, ocr_used,
                       ocr_provider
                from document_index where document_id = %s
                """,
                (document_id,),
            )
            row = cur.fetchone()
        return dict(row) if row else None

    # -- chunks --------------------------------------------------------------

    def replace_chunks(
        self,
        document_id: str,
        chunks: list[Document],
        embeddings: list[list[float]],
    ) -> None:
        if len(chunks) != len(embeddings):
            raise ValueError(
                f"got {len(embeddings)} embeddings for {len(chunks)} chunks"
            )
        for embedding in embeddings:
            if len(embedding) != self._embedding_dim:
                raise ValueError(
                    f"embedding dimension {len(embedding)} does not match "
                    f"RAG_EMBEDDING_DIM={self._embedding_dim}"
                )

        from pgvector import Vector

        self.ensure_schema()
        rows = [
            (
                document_id,
                chunk.metadata.get("chunk_index", index),
                chunk.metadata.get("page_number"),
                chunk.metadata.get("source_label", "document"),
                chunk.page_content,
                Vector(embedding),
            )
            for index, (chunk, embedding) in enumerate(
                zip(chunks, embeddings, strict=True)
            )
        ]
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "delete from document_chunk where document_id = %s", (document_id,)
            )
            cur.executemany(
                """
                insert into document_chunk (
                    document_id, chunk_index, page_number, source_label, content,
                    embedding
                ) values (%s, %s, %s, %s, %s, %s)
                """,
                rows,
            )

    def similarity_search(
        self, document_id: str, query_embedding: list[float], k: int
    ) -> list[Document]:
        from pgvector import Vector

        self.ensure_schema()
        from psycopg.rows import dict_row

        with self._connect() as conn, conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                select chunk_index, page_number, source_label, content
                from document_chunk
                where document_id = %s
                order by embedding <=> %s
                limit %s
                """,
                (document_id, Vector(query_embedding), k),
            )
            rows = cur.fetchall()
        return [
            Document(
                page_content=row["content"],
                metadata={
                    "document_id": document_id,
                    "chunk_index": row["chunk_index"],
                    "page_number": row["page_number"],
                    "source_label": row["source_label"],
                },
            )
            for row in rows
        ]

    def count_chunks(self, document_id: str) -> int:
        self.ensure_schema()
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "select count(*) from document_chunk where document_id = %s",
                (document_id,),
            )
            return int(cur.fetchone()[0])

    def delete_document(self, document_id: str) -> None:
        self.ensure_schema()
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "delete from document_chunk where document_id = %s", (document_id,)
            )
            cur.execute(
                "delete from document_index where document_id = %s", (document_id,)
            )


class MemoryStore:
    """In-process store for offline tests (same interface, cosine similarity)."""

    def __init__(self) -> None:
        self.statuses: dict[str, dict[str, Any]] = {}
        self.chunks: dict[str, list[tuple[Document, list[float]]]] = defaultdict(list)

    def write_status(self, document_id: str, **kwargs: Any) -> None:
        self.statuses[document_id] = _status_row(document_id, **kwargs)

    def read_status(self, document_id: str) -> dict[str, Any] | None:
        status = self.statuses.get(document_id)
        return dict(status) if status else None

    def replace_chunks(
        self,
        document_id: str,
        chunks: list[Document],
        embeddings: list[list[float]],
    ) -> None:
        if len(chunks) != len(embeddings):
            raise ValueError(
                f"got {len(embeddings)} embeddings for {len(chunks)} chunks"
            )
        self.chunks[document_id] = list(zip(chunks, embeddings, strict=True))

    def similarity_search(
        self, document_id: str, query_embedding: list[float], k: int
    ) -> list[Document]:
        def cosine(a: list[float], b: list[float]) -> float:
            dot = sum(x * y for x, y in zip(a, b, strict=True))
            norm = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
            return dot / norm if norm else 0.0

        ranked = sorted(
            self.chunks.get(document_id, []),
            key=lambda item: cosine(item[1], query_embedding),
            reverse=True,
        )
        return [doc for doc, _ in ranked[:k]]

    def count_chunks(self, document_id: str) -> int:
        return len(self.chunks.get(document_id, []))

    def delete_document(self, document_id: str) -> None:
        self.statuses.pop(document_id, None)
        self.chunks.pop(document_id, None)


_store: Store | None = None
_store_lock = threading.Lock()


def get_store() -> Store:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                if settings.store_backend == "memory":
                    _store = MemoryStore()
                else:
                    if not settings.database_url:
                        raise RuntimeError(
                            "DATABASE_URL is required for the pgvector store "
                            "(set BOOKIFY_STORE=memory for an in-process store)."
                        )
                    _store = PostgresStore(
                        settings.database_url, settings.embedding_dim
                    )
    return _store


def set_store(store: Store | None) -> None:
    """Swap the process-wide store (tests). ``None`` resets the default."""
    global _store
    with _store_lock:
        _store = store
