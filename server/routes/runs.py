"""Run launch, state, live events, and results. Contracts in API.md."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from executor.daytona_client import check_reachable
from server import db
from server.config import config
from server.errors import ApiError
from server.events import SSE_HEADERS, Event, channel_stream
from server.run_executor import start_run

router = APIRouter()

TERMINAL_RUN_STATUSES = ("complete", "failed")


class RunRequest(BaseModel):
    brief_id: str
    rows: list[dict[str, Any]]


def _validate_rows(rows: list[dict[str, Any]], brief_content: dict[str, Any]) -> None:
    """Reject anything the workers could not act on, naming the specific problem.

    A Brief with no variables requires no columns, so a single empty row is valid — that is
    a workflow which takes no input data and runs once.
    """
    if not rows:
        raise ApiError(400, "invalid_rows", "rows must contain at least one row.")
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise ApiError(400, "invalid_rows", f"rows[{index}] is not an object.")
        for key, value in row.items():
            if isinstance(value, (dict, list)):
                raise ApiError(
                    400,
                    "invalid_rows",
                    f"rows[{index}].{key} must be a scalar, not a nested value.",
                )

    first_keys = set(rows[0])
    for index, row in enumerate(rows[1:], start=1):
        if set(row) != first_keys:
            missing = sorted(first_keys - set(row))
            extra = sorted(set(row) - first_keys)
            detail = f"missing {missing}" if missing else f"unexpected {extra}"
            raise ApiError(
                400, "ragged_rows", f"rows[{index}] does not match rows[0]: {detail}."
            )

    required = {variable["source_column"] for variable in brief_content["variables"]}
    absent = sorted(required - first_keys)
    if absent:
        raise ApiError(
            400,
            "missing_column",
            f"The Brief needs a column named {absent[0]!r}, which the rows do not have."
            + (f" Also missing: {absent[1:]}." if len(absent) > 1 else ""),
        )


@router.post("/runs", status_code=202)
async def create_run(request: RunRequest) -> JSONResponse:
    """Launch a Brief against many input rows, one worker per row."""
    brief = db.get_brief(request.brief_id)
    if brief is None:
        raise ApiError(404, "brief_not_found", "No brief with that id.")

    _validate_rows(request.rows, brief.content)

    if len(request.rows) > config.max_parallel_workers:
        raise ApiError(
            409,
            "too_many_rows",
            f"This account allows {config.max_parallel_workers} workers at once and "
            f"{len(request.rows)} rows were supplied. Launch fewer rows.",
        )

    # Nothing is created on a 500: reachability and configuration are checked before any row
    # is written, so a failure here leaves no partial run behind.
    snapshot = config.snapshot_name
    if not snapshot:
        raise ApiError(
            500, "snapshot_not_configured", "OWARI_SNAPSHOT_NAME is not set."
        )
    if not await run_in_threadpool(check_reachable, config.daytona_api_key):
        raise ApiError(
            500, "daytona_unreachable", "The Daytona API could not be reached."
        )

    run = db.create_run(request.brief_id, snapshot, request.rows)
    for row_index, row in enumerate(request.rows):
        db.create_worker(run.id, row_index, row)

    start_run(run.id, brief.content, config.daytona_api_key, snapshot)

    return JSONResponse(
        status_code=202,
        content={
            "id": run.id,
            "brief_id": run.brief_id,
            "status": run.status,
            "worker_count": len(request.rows),
            "created_at": run.created_at,
        },
    )


def _require_run(run_id: str) -> db.Run:
    run = db.get_run(run_id)
    if run is None:
        raise ApiError(404, "run_not_found", "No run with that id.")
    return run


@router.get("/runs/{run_id}")
async def get_run(run_id: str) -> dict[str, Any]:
    """Full run state. `last_screenshot` is excluded — it is large and arrives over SSE."""
    run = _require_run(run_id)
    return {
        "id": run.id,
        "brief_id": run.brief_id,
        "snapshot_name": run.snapshot_name,
        "status": run.status,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
        "workers": [
            {
                "id": worker.id,
                "row_index": worker.row_index,
                "row_data": worker.row_data,
                "status": worker.status,
                "current_step_id": worker.current_step_id,
                "error": worker.error,
            }
            for worker in db.list_workers(run_id)
        ],
    }


@router.get("/runs/{run_id}/events")
async def run_events(run_id: str) -> StreamingResponse:
    """SSE stream driving the live grid.

    A run that has already finished gets its terminal event and an immediate close, rather
    than a connection that hangs forever — the dashboard reconnects after a page reload.
    """
    run = _require_run(run_id)
    if run.status in TERMINAL_RUN_STATUSES:
        final = Event("run", {"status": run.status, "finished_at": run.finished_at})

        async def closed() -> Any:
            yield final.encode()

        return StreamingResponse(
            closed(), media_type="text/event-stream", headers=SSE_HEADERS
        )

    return StreamingResponse(
        channel_stream(run_id), media_type="text/event-stream", headers=SSE_HEADERS
    )


@router.get("/runs/{run_id}/results")
async def run_results(run_id: str) -> dict[str, Any]:
    """The final results table. Available only once the run has finished."""
    run = _require_run(run_id)
    if run.status not in TERMINAL_RUN_STATUSES:
        raise ApiError(
            409, "run_in_progress", f"This run is {run.status}. Results are not ready."
        )

    brief = db.get_brief(run.brief_id)
    steps_total = len(brief.content["steps"]) if brief is not None else 0
    results = []
    for worker in db.list_workers(run_id):
        step_results = db.list_step_results(worker.id)
        results.append(
            {
                "row_index": worker.row_index,
                "row_data": worker.row_data,
                "status": worker.status,
                "steps_completed": sum(
                    1 for s in step_results if s.status in ("ok", "retried")
                ),
                "steps_total": steps_total,
                "error": worker.error,
            }
        )
    return {"run_id": run_id, "results": results}


@router.get("/recordings/{recording_id}/events")
async def recording_events(recording_id: str) -> StreamingResponse:
    """SSE stream of comprehension progress. Channel id is the recording id."""
    recording = db.get_recording(recording_id)
    if recording is None:
        raise ApiError(404, "recording_not_found", "No recording with that id.")
    return StreamingResponse(
        channel_stream(recording_id),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )
