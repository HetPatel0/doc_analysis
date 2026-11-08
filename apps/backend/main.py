"""Bookify API entrypoint.

Thin composition root: app factory, lifespan, middleware, router mounting.
Business logic lives in `app/services/*`, HTTP layer in `app/routers/*`.
Run with: uvicorn main:app (from apps/backend)
"""

from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager

from app import dependencies as deps
from app.config import settings
from app.observability import init_sentry
from app.routers import chat, documents, health
from app.services import chunking
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

init_sentry()
logger = logging.getLogger(__name__)


def _warm_dependencies() -> None:
    """Load the heavy stack off the request path.

    tiktoken's first use can fetch its vocab file and LangChain imports are
    slow. Doing this in a background thread keeps the health check fast while
    the first upload/chat still finds everything warm.
    """
    try:
        deps.get_indexing_dependencies()
        deps.get_embedding_model()
        deps.get_prompt()
        chunking.warm()
        logger.info("dependency warm-up finished")
    except Exception:
        logger.exception("dependency warm-up failed; requests will warm lazily")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.warm_on_startup:
        threading.Thread(
            target=_warm_dependencies,
            name="bookify-warmup",
            daemon=True,
        ).start()
    yield


app = FastAPI(title="Bookify API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(documents.router)
app.include_router(chat.router)
