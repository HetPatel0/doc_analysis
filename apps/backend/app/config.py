from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _csv(name: str, default: str) -> list[str]:
    return [
        origin.strip()
        for origin in os.getenv(name, default).split(",")
        if origin.strip()
    ]


def _flag(name: str, default: str) -> bool:
    return os.getenv(name, default).lower() in {"1", "true", "yes"}


class Settings:
    """Central place for every environment-driven setting."""

    base_dir: Path = Path(__file__).resolve().parent.parent
    storage_dir: Path = Path(os.getenv("BOOKIFY_STORAGE_DIR", str(base_dir)))
    uploads_dir: Path = Path(
        os.getenv("BOOKIFY_UPLOADS_DIR", str(storage_dir / "uploads"))
    )
    vectorstores_dir: Path = Path(
        os.getenv("BOOKIFY_VECTORSTORES_DIR", str(storage_dir / "vectorstores"))
    )

    chunk_size: int = int(os.getenv("RAG_CHUNK_SIZE", "900"))
    chunk_overlap: int = int(os.getenv("RAG_CHUNK_OVERLAP", "120"))
    min_chunk_chars: int = 80
    retrieval_fetch_k: int = int(os.getenv("RAG_RETRIEVAL_FETCH_K", "16"))
    retrieval_top_k: int = int(os.getenv("RAG_RETRIEVAL_TOP_K", "5"))

    mistral_model: str = os.getenv("MISTRAL_MODEL", "mistral-small-2506")
    cors_origins: list[str] = _csv(
        "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    )
    warm_on_startup: bool = _flag("BOOKIFY_WARM_ON_STARTUP", "true")

    api_secret: str = os.getenv("BOOKIFY_API_SECRET", "")
    max_upload_mb: int = int(os.getenv("BOOKIFY_MAX_UPLOAD_MB", "20"))

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


settings = Settings()
settings.uploads_dir.mkdir(parents=True, exist_ok=True)
settings.vectorstores_dir.mkdir(parents=True, exist_ok=True)
