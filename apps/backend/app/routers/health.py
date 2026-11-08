from fastapi import APIRouter, HTTPException

from app.services.store import get_store

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    """Liveness: the process is up. Used by Railway's health check."""
    return {"status": "ok"}


@router.get("/health/ready")
def readiness() -> dict[str, str]:
    """Readiness: the vector store answered a trivial query."""
    try:
        get_store().ping()
    except Exception as exc:
        raise HTTPException(
            status_code=503, detail="Vector store unavailable."
        ) from exc
    return {"status": "ready"}
