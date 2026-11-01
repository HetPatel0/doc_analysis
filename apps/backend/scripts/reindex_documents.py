"""Backfill the pgvector store from PDFs already on disk.

Phase 3.1 moved chunks out of per-document Chroma directories into Postgres.
Uploaded PDFs are still on the volume, so an existing deployment can be
re-indexed without asking users to upload again.

Usage, from `apps/backend` (needs MISTRAL_API_KEY and DATABASE_URL):

    .venv/bin/python scripts/reindex_documents.py --dry-run
    .venv/bin/python scripts/reindex_documents.py
    .venv/bin/python scripts/reindex_documents.py --document-id <id>

The script is idempotent: `document_chunk` rows for a document are replaced and
its `document_index` status is rewritten.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--document-id",
        action="append",
        default=None,
        help="re-index only this document id (repeatable)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="list what would be re-indexed without calling the API",
    )
    return parser.parse_args()


UPLOAD_NAME = re.compile(
    r"^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(.+)$"
)


def uploaded_documents() -> list[tuple[str, str, Path]]:
    """Return (document_id, file_name, path) for every `<uuid>-<name>` upload."""
    from app.config import settings

    found: list[tuple[str, str, Path]] = []
    for path in sorted(settings.uploads_dir.iterdir()):
        match = UPLOAD_NAME.match(path.name)
        if not path.is_file() or match is None:
            continue
        found.append((match.group(1), match.group(2), path))
    return found


def main() -> int:
    args = parse_args()

    from dotenv import dotenv_values

    for key, value in dotenv_values(BACKEND_ROOT / ".env").items():
        if value is not None:
            os.environ.setdefault(key, value)

    from app.config import settings
    from app.services import documents
    from app.services.store import get_store

    if not settings.database_url and settings.store_backend != "memory":
        print("DATABASE_URL is not set.", file=sys.stderr)
        return 2

    selected = set(args.document_id or [])
    targets = [
        item
        for item in uploaded_documents()
        if not selected or item[0] in selected
    ]

    if not targets:
        print("No uploaded PDFs found in", settings.uploads_dir, file=sys.stderr)
        return 2

    store = get_store()
    failed = 0
    for document_id, file_name, path in targets:
        if args.dry_run:
            print(f"would re-index {document_id} ({file_name})")
            continue
        print(f"re-indexing {document_id} ({file_name}) ...", end=" ", flush=True)
        documents.index_pdf(document_id, file_name, path)
        status = store.read_status(document_id)
        if status and status["status"] == "ready":
            print(f"ok ({status['chunks_indexed']} chunks)")
        else:
            failed += 1
            print(f"FAILED: {status['error'] if status else 'no status'}")

    if not args.dry_run:
        print(f"\nre-indexed {len(targets) - failed}/{len(targets)} documents")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
