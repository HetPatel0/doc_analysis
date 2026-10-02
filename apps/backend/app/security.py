from __future__ import annotations

import secrets

from fastapi import Header, HTTPException

from app.config import settings


def require_backend_auth(
    x_bookify_secret: str | None = Header(default=None, alias="X-Bookify-Secret"),
) -> None:
    """Shared-secret guard for frontend -> backend calls (controllers)."""
    if not settings.api_secret:
        return
    if not secrets.compare_digest(x_bookify_secret or "", settings.api_secret):
        raise HTTPException(status_code=401, detail="Unauthorized.")
