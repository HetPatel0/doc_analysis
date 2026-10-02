"""Bookify API entrypoint.

Thin composition root: app factory, lifespan, middleware, router mounting.
Business logic lives in `app/services/*`, HTTP layer in `app/routers/*`.
Run with: uvicorn main:app (from apps/backend)
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import dependencies as deps
from app.config import settings
from app.routers import chat, documents, health


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.warm_on_startup:
        # Warm the heavy indexing stack once at startup instead of during the first upload.
        deps.get_indexing_dependencies()
        deps.get_embedding_model()
        deps.get_prompt()
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
