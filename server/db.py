"""SQLite access layer. Every query in the system lives here.

No module outside this file contains SQL, and no module outside this file imports sqlite3
(see the data-access convention in CLAUDE.md). Rows are returned as typed dataclasses with
JSON columns already parsed, so routes never touch serialisation.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from server.config import DATABASE_PATH

SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"
BUSY_TIMEOUT_SECONDS = 30.0

RecordingStatus = Literal["uploaded", "comprehending", "comprehended", "failed"]
RunStatus = Literal["pending", "running", "complete", "failed"]
WorkerStatus = Literal["pending", "running", "complete", "failed", "skipped"]
StepStatus = Literal["ok", "retried", "failed", "skipped"]


class RecordNotFoundError(LookupError):
    """A row addressed by id does not exist."""


# --------------------------------------------------------------------------- rows


@dataclass(frozen=True)
class Recording:
    id: str
    task_name: str
    video_path: str
    duration_seconds: float
    status: RecordingStatus
    error: str | None
    created_at: str


@dataclass(frozen=True)
class RecordingListItem:
    id: str
    task_name: str
    duration_seconds: float
    status: RecordingStatus
    brief_id: str | None
    created_at: str


@dataclass(frozen=True)
class Brief:
    id: str
    recording_id: str
    content: dict[str, Any]
    version: int
    created_at: str
    updated_at: str


@dataclass(frozen=True)
class Run:
    id: str
    brief_id: str
    snapshot_name: str
    rows: list[dict[str, Any]]
    status: RunStatus
    started_at: str | None
    finished_at: str | None
    created_at: str


@dataclass(frozen=True)
class Worker:
    id: str
    run_id: str
    row_index: int
    row_data: dict[str, Any]
    sandbox_id: str | None
    status: WorkerStatus
    current_step_id: int | None
    last_screenshot: str | None
    error: str | None
    created_at: str


@dataclass(frozen=True)
class StepResult:
    id: str
    worker_id: str
    step_id: int
    status: StepStatus
    resolved_target: dict[str, Any] | None
    error: str | None
    duration_ms: int
    created_at: str


# ------------------------------------------------------------------- connection


def now_iso() -> str:
    """Current UTC time as an ISO-8601 string, the format every timestamp column uses."""
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def new_id() -> str:
    return str(uuid.uuid4())


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    """Open a connection for one unit of work, committing on success and rolling back on error.

    A fresh connection per operation is correct here: the executor runs workers on background
    threads, and sqlite3 connections are not safe to share across them.
    """
    connection = sqlite3.connect(DATABASE_PATH, timeout=BUSY_TIMEOUT_SECONDS)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def init_database() -> None:
    """Apply the DDL if the database file is absent. Called once at server startup."""
    if not SCHEMA_PATH.is_file():
        raise FileNotFoundError(f"schema.sql is missing at {SCHEMA_PATH}")
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as connection:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))


# ------------------------------------------------------------------- recordings


def _to_recording(row: sqlite3.Row) -> Recording:
    return Recording(
        id=row["id"],
        task_name=row["task_name"],
        video_path=row["video_path"],
        duration_seconds=row["duration_seconds"],
        status=row["status"],
        error=row["error"],
        created_at=row["created_at"],
    )


def create_recording(
    task_name: str, video_path: str, duration_seconds: float
) -> Recording:
    recording = Recording(
        id=new_id(),
        task_name=task_name,
        video_path=video_path,
        duration_seconds=duration_seconds,
        status="uploaded",
        error=None,
        created_at=now_iso(),
    )
    with connect() as connection:
        connection.execute(
            "INSERT INTO recordings (id, task_name, video_path, duration_seconds, status, error,"
            " created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                recording.id,
                recording.task_name,
                recording.video_path,
                recording.duration_seconds,
                recording.status,
                recording.error,
                recording.created_at,
            ),
        )
    return recording


def get_recording(recording_id: str) -> Recording | None:
    with connect() as connection:
        row = connection.execute(
            "SELECT * FROM recordings WHERE id = ?", (recording_id,)
        ).fetchone()
    return _to_recording(row) if row is not None else None


def list_recordings() -> list[RecordingListItem]:
    """Newest first, each carrying the id of its most recent Brief if one exists."""
    with connect() as connection:
        rows = connection.execute(
            "SELECT r.id, r.task_name, r.duration_seconds, r.status, r.created_at,"
            "       (SELECT b.id FROM briefs b WHERE b.recording_id = r.id"
            "        ORDER BY b.created_at DESC LIMIT 1) AS brief_id"
            " FROM recordings r ORDER BY r.created_at DESC"
        ).fetchall()
    return [
        RecordingListItem(
            id=row["id"],
            task_name=row["task_name"],
            duration_seconds=row["duration_seconds"],
            status=row["status"],
            brief_id=row["brief_id"],
            created_at=row["created_at"],
        )
        for row in rows
    ]


def set_recording_status(
    recording_id: str, status: RecordingStatus, error: str | None = None
) -> None:
    with connect() as connection:
        cursor = connection.execute(
            "UPDATE recordings SET status = ?, error = ? WHERE id = ?",
            (status, error, recording_id),
        )
    if cursor.rowcount == 0:
        raise RecordNotFoundError(f"No recording with id {recording_id}")


# ----------------------------------------------------------------------- briefs


def _to_brief(row: sqlite3.Row) -> Brief:
    return Brief(
        id=row["id"],
        recording_id=row["recording_id"],
        content=json.loads(row["content"]),
        version=row["version"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def create_brief(recording_id: str, content: dict[str, Any]) -> Brief:
    """Insert a validated Brief. Callers validate via server.brief_schema first."""
    timestamp = now_iso()
    brief = Brief(
        id=new_id(),
        recording_id=recording_id,
        content=content,
        version=1,
        created_at=timestamp,
        updated_at=timestamp,
    )
    with connect() as connection:
        connection.execute(
            "INSERT INTO briefs (id, recording_id, content, version, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (
                brief.id,
                brief.recording_id,
                json.dumps(brief.content),
                brief.version,
                brief.created_at,
                brief.updated_at,
            ),
        )
    return brief


def get_brief(brief_id: str) -> Brief | None:
    with connect() as connection:
        row = connection.execute(
            "SELECT * FROM briefs WHERE id = ?", (brief_id,)
        ).fetchone()
    return _to_brief(row) if row is not None else None


def replace_brief_content(brief_id: str, content: dict[str, Any]) -> Brief:
    """Replace content wholesale and increment version. Callers validate first."""
    with connect() as connection:
        cursor = connection.execute(
            "UPDATE briefs SET content = ?, version = version + 1, updated_at = ? WHERE id = ?",
            (json.dumps(content), now_iso(), brief_id),
        )
        if cursor.rowcount == 0:
            raise RecordNotFoundError(f"No brief with id {brief_id}")
        row = connection.execute(
            "SELECT * FROM briefs WHERE id = ?", (brief_id,)
        ).fetchone()
    return _to_brief(row)


# ------------------------------------------------------------------------- runs


def _to_run(row: sqlite3.Row) -> Run:
    return Run(
        id=row["id"],
        brief_id=row["brief_id"],
        snapshot_name=row["snapshot_name"],
        rows=json.loads(row["rows"]),
        status=row["status"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
        created_at=row["created_at"],
    )


def create_run(brief_id: str, snapshot_name: str, rows: list[dict[str, Any]]) -> Run:
    run = Run(
        id=new_id(),
        brief_id=brief_id,
        snapshot_name=snapshot_name,
        rows=rows,
        status="pending",
        started_at=None,
        finished_at=None,
        created_at=now_iso(),
    )
    with connect() as connection:
        connection.execute(
            'INSERT INTO runs (id, brief_id, snapshot_name, "rows", status, started_at,'
            " finished_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                run.id,
                run.brief_id,
                run.snapshot_name,
                json.dumps(run.rows),
                run.status,
                run.started_at,
                run.finished_at,
                run.created_at,
            ),
        )
    return run


def get_run(run_id: str) -> Run | None:
    with connect() as connection:
        row = connection.execute(
            "SELECT * FROM runs WHERE id = ?", (run_id,)
        ).fetchone()
    return _to_run(row) if row is not None else None


def mark_run_started(run_id: str) -> None:
    with connect() as connection:
        cursor = connection.execute(
            "UPDATE runs SET status = 'running', started_at = ? WHERE id = ?",
            (now_iso(), run_id),
        )
    if cursor.rowcount == 0:
        raise RecordNotFoundError(f"No run with id {run_id}")


def mark_run_finished(run_id: str, status: RunStatus) -> str:
    """Set the terminal status and finished_at. Returns the finished_at written."""
    finished_at = now_iso()
    with connect() as connection:
        cursor = connection.execute(
            "UPDATE runs SET status = ?, finished_at = ? WHERE id = ?",
            (status, finished_at, run_id),
        )
    if cursor.rowcount == 0:
        raise RecordNotFoundError(f"No run with id {run_id}")
    return finished_at


# ---------------------------------------------------------------------- workers


def _to_worker(row: sqlite3.Row) -> Worker:
    return Worker(
        id=row["id"],
        run_id=row["run_id"],
        row_index=row["row_index"],
        row_data=json.loads(row["row_data"]),
        sandbox_id=row["sandbox_id"],
        status=row["status"],
        current_step_id=row["current_step_id"],
        last_screenshot=row["last_screenshot"],
        error=row["error"],
        created_at=row["created_at"],
    )


def create_worker(run_id: str, row_index: int, row_data: dict[str, Any]) -> Worker:
    worker = Worker(
        id=new_id(),
        run_id=run_id,
        row_index=row_index,
        row_data=row_data,
        sandbox_id=None,
        status="pending",
        current_step_id=None,
        last_screenshot=None,
        error=None,
        created_at=now_iso(),
    )
    with connect() as connection:
        connection.execute(
            "INSERT INTO workers (id, run_id, row_index, row_data, sandbox_id, status,"
            " current_step_id, last_screenshot, error, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                worker.id,
                worker.run_id,
                worker.row_index,
                json.dumps(worker.row_data),
                worker.sandbox_id,
                worker.status,
                worker.current_step_id,
                worker.last_screenshot,
                worker.error,
                worker.created_at,
            ),
        )
    return worker


def get_worker(worker_id: str) -> Worker | None:
    with connect() as connection:
        row = connection.execute(
            "SELECT * FROM workers WHERE id = ?", (worker_id,)
        ).fetchone()
    return _to_worker(row) if row is not None else None


def list_workers(run_id: str) -> list[Worker]:
    with connect() as connection:
        rows = connection.execute(
            "SELECT * FROM workers WHERE run_id = ? ORDER BY row_index", (run_id,)
        ).fetchall()
    return [_to_worker(row) for row in rows]


def set_worker_sandbox(worker_id: str, sandbox_id: str) -> None:
    with connect() as connection:
        cursor = connection.execute(
            "UPDATE workers SET sandbox_id = ? WHERE id = ?", (sandbox_id, worker_id)
        )
    if cursor.rowcount == 0:
        raise RecordNotFoundError(f"No worker with id {worker_id}")


def set_worker_progress(
    worker_id: str, status: WorkerStatus, current_step_id: int | None
) -> None:
    with connect() as connection:
        cursor = connection.execute(
            "UPDATE workers SET status = ?, current_step_id = ? WHERE id = ?",
            (status, current_step_id, worker_id),
        )
    if cursor.rowcount == 0:
        raise RecordNotFoundError(f"No worker with id {worker_id}")


def set_worker_screenshot(worker_id: str, screenshot: str) -> None:
    """Overwrite the worker's most recent frame. Base64 JPEG, compressed — see API.md."""
    with connect() as connection:
        cursor = connection.execute(
            "UPDATE workers SET last_screenshot = ? WHERE id = ?",
            (screenshot, worker_id),
        )
    if cursor.rowcount == 0:
        raise RecordNotFoundError(f"No worker with id {worker_id}")


def set_worker_failed(worker_id: str, error: str) -> None:
    with connect() as connection:
        cursor = connection.execute(
            "UPDATE workers SET status = 'failed', error = ? WHERE id = ?",
            (error, worker_id),
        )
    if cursor.rowcount == 0:
        raise RecordNotFoundError(f"No worker with id {worker_id}")


# ----------------------------------------------------------------- step results


def _to_step_result(row: sqlite3.Row) -> StepResult:
    raw_target = row["resolved_target"]
    return StepResult(
        id=row["id"],
        worker_id=row["worker_id"],
        step_id=row["step_id"],
        status=row["status"],
        resolved_target=json.loads(raw_target) if raw_target is not None else None,
        error=row["error"],
        duration_ms=row["duration_ms"],
        created_at=row["created_at"],
    )


def create_step_result(
    worker_id: str,
    step_id: int,
    status: StepStatus,
    duration_ms: int,
    resolved_target: dict[str, Any] | None = None,
    error: str | None = None,
) -> StepResult:
    result = StepResult(
        id=new_id(),
        worker_id=worker_id,
        step_id=step_id,
        status=status,
        resolved_target=resolved_target,
        error=error,
        duration_ms=duration_ms,
        created_at=now_iso(),
    )
    with connect() as connection:
        connection.execute(
            "INSERT INTO step_results (id, worker_id, step_id, status, resolved_target, error,"
            " duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                result.id,
                result.worker_id,
                result.step_id,
                result.status,
                json.dumps(result.resolved_target)
                if result.resolved_target is not None
                else None,
                result.error,
                result.duration_ms,
                result.created_at,
            ),
        )
    return result


def list_step_results(worker_id: str) -> list[StepResult]:
    with connect() as connection:
        rows = connection.execute(
            "SELECT * FROM step_results WHERE worker_id = ? ORDER BY created_at",
            (worker_id,),
        ).fetchall()
    return [_to_step_result(row) for row in rows]
