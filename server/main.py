"""FastAPI application: route registration, CORS, and the health check.

Binds to 127.0.0.1 only (see the uvicorn command in CLAUDE.md). There is no auth layer
by design — the server must never be exposed on a network interface.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from executor.daytona_client import check_reachable
from server.config import config
from server.db import init_database
from server.errors import register_error_handlers
from server.routes import briefs, recordings, runs

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
)

DASHBOARD_ORIGIN = "http://localhost:5173"


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Apply the DDL before the first request. Idempotent — every statement is IF NOT EXISTS."""
    init_database()
    yield


app = FastAPI(
    title="Crewmate",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[DASHBOARD_ORIGIN],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["*"],
)

register_error_handlers(app)
app.include_router(recordings.router)
app.include_router(briefs.router)
app.include_router(runs.router)


@app.get("/health")
async def health() -> dict[str, object]:
    """Startup check for the dashboard and the overlay. See API.md."""
    daytona_ok = await run_in_threadpool(check_reachable, config.daytona_api_key)
    return {
        "ok": True,
        "daytona": daytona_ok,
        "snapshot": config.snapshot_name,
        "vision_model": config.vision_model,
    }
