"""Offline tests for the storage interface.

`MemoryStore` implements the same contract as `PostgresStore`, so these tests
pin the behaviour both backends must share: status defaults/upserts, chunk
replacement, embedding validation, similarity ordering and deletes.
"""

from __future__ import annotations

import pytest
from app.services.store import MemoryStore
from langchain_core.documents import Document


def make_doc(text: str, page: int = 1, chunk: int = 0) -> Document:
    return Document(
        page_content=text,
        metadata={
            "document_id": "doc",
            "page_number": page,
            "chunk_index": chunk,
            "source_label": f"p. {page}, chunk {chunk + 1}",
        },
    )


def test_status_roundtrip_fills_defaults():
    store = MemoryStore()
    store.write_status("doc", file_name="a.pdf", status="queued")

    record = store.read_status("doc")

    assert record["status"] == "queued"
    assert record["chunks_indexed"] is None
    assert record["ocr_used"] is False
    assert record["ocr_provider"] is None
    assert record["key_points"] == []
    assert record["quiz"] == []


def test_write_status_upserts_instead_of_duplicating():
    store = MemoryStore()
    store.write_status("doc", file_name="a.pdf", status="indexing")
    store.write_status(
        "doc", file_name="a.pdf", status="ready", chunks_indexed=4
    )

    assert store.read_status("doc")["status"] == "ready"
    assert store.read_status("doc")["chunks_indexed"] == 4
    assert len(store.statuses) == 1


def test_unknown_document_reads_as_none():
    assert MemoryStore().read_status("missing") is None


def test_replace_chunks_replaces_the_previous_index():
    store = MemoryStore()
    store.replace_chunks("doc", [make_doc("old")], [[1.0, 0.0]])
    store.replace_chunks(
        "doc", [make_doc("new a", chunk=0), make_doc("new b", chunk=1)], [[1.0, 0.0], [0.0, 1.0]]
    )

    assert store.count_chunks("doc") == 2
    assert [doc.page_content for doc, _ in store.chunks["doc"]] == ["new a", "new b"]


def test_replace_chunks_rejects_mismatched_lengths():
    store = MemoryStore()

    with pytest.raises(ValueError, match="embeddings for"):
        store.replace_chunks("doc", [make_doc("a")], [])


def test_similarity_search_orders_by_cosine_and_limits():
    store = MemoryStore()
    store.replace_chunks(
        "doc",
        [make_doc("exact"), make_doc("near"), make_doc("orthogonal")],
        [[1.0, 0.0], [0.9, 0.1], [0.0, 1.0]],
    )

    results = store.similarity_search("doc", [1.0, 0.0], 2)

    assert [doc.page_content for doc in results] == ["exact", "near"]


def test_delete_removes_status_and_chunks():
    store = MemoryStore()
    store.write_status("doc", file_name="a.pdf", status="ready", chunks_indexed=1)
    store.replace_chunks("doc", [make_doc("a")], [[1.0, 0.0]])

    store.delete_document("doc")

    assert store.read_status("doc") is None
    assert store.count_chunks("doc") == 0


def test_status_records_and_updates_index_attempts():
    store = MemoryStore()
    store.write_status("doc", file_name="a.pdf", status="queued", index_attempts=1)
    assert store.read_status("doc")["index_attempts"] == 1

    # write_status without index_attempts retains existing attempt count
    store.write_status("doc", file_name="a.pdf", status="indexing")
    assert store.read_status("doc")["index_attempts"] == 1

    store.write_status("doc", file_name="a.pdf", status="queued", index_attempts=2)
    assert store.read_status("doc")["index_attempts"] == 2


def test_list_stalled_filters_by_status_and_time():
    from datetime import UTC, datetime, timedelta

    store = MemoryStore()
    now = datetime.now(UTC)
    cutoff = now - timedelta(seconds=60)

    store.write_status("old_indexing", file_name="a.pdf", status="indexing")
    store.statuses["old_indexing"]["updated_at"] = now - timedelta(seconds=120)

    store.write_status("old_queued", file_name="b.pdf", status="queued")
    store.statuses["old_queued"]["updated_at"] = now - timedelta(seconds=90)

    store.write_status("recent_indexing", file_name="c.pdf", status="indexing")
    store.statuses["recent_indexing"]["updated_at"] = now - timedelta(seconds=10)

    store.write_status("old_ready", file_name="d.pdf", status="ready")
    store.statuses["old_ready"]["updated_at"] = now - timedelta(seconds=120)

    store.write_status("old_failed", file_name="e.pdf", status="failed")
    store.statuses["old_failed"]["updated_at"] = now - timedelta(seconds=120)

    stalled = store.list_stalled(cutoff)
    stalled_ids = {item["document_id"] for item in stalled}
    assert stalled_ids == {"old_indexing", "old_queued"}
