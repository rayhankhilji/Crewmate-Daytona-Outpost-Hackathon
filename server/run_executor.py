"""Orchestration: a Brief plus input rows becomes N sandboxes doing the work.

This is the seam between the server and the executor. The server owns persistence and SSE;
`executor/` owns Daytona and the step loop. This module implements the reporter interface
the runner calls into, and drives one worker thread per input row.

Runs happen on background threads because the Daytona SDK is synchronous. Nothing here
blocks the event loop, and every event reaches subscribers through the broadcaster, which is
safe to publish to from any thread.
"""

from __future__ import annotations

import logging
import threading
from typing import Any

from executor.fork import ForkError, WorkerSandbox, worker_sandboxes
from executor.runner import WorkerOutcome, run_worker
from server import db
from server.events import broadcaster

logger = logging.getLogger("owari.server.runs")


class _Reporter:
    """Persists a worker's progress and publishes it to that run's SSE channel."""

    def __init__(self, run_id: str, worker: db.Worker) -> None:
        self._run_id = run_id
        self._worker = worker

    def _publish_worker(
        self,
        status: str,
        current_step_id: int | None,
        screenshot: str | None,
        error: str | None,
    ) -> None:
        broadcaster.publish(
            self._run_id,
            "worker",
            {
                "worker_id": self._worker.id,
                "row_index": self._worker.row_index,
                "status": status,
                "current_step_id": current_step_id,
                "screenshot": screenshot,
                "error": error,
            },
        )

    def step_started(self, step_id: int) -> None:
        db.set_worker_progress(self._worker.id, "running", step_id)
        self._publish_worker("running", step_id, None, None)

    def step_finished(
        self,
        step_id: int,
        status: str,
        duration_ms: int,
        resolved_target: dict[str, Any] | None,
        error: str | None,
    ) -> None:
        db.create_step_result(
            worker_id=self._worker.id,
            step_id=step_id,
            status=status,
            duration_ms=duration_ms,
            resolved_target=resolved_target,
            error=error,
        )
        broadcaster.publish(
            self._run_id,
            "step",
            {
                "worker_id": self._worker.id,
                "step_id": step_id,
                "status": status,
                "duration_ms": duration_ms,
            },
        )

    def screenshot(self, image_base64: str) -> None:
        db.set_worker_screenshot(self._worker.id, image_base64)
        worker = db.get_worker(self._worker.id)
        if worker is None:
            return
        self._publish_worker(
            worker.status, worker.current_step_id, image_base64, worker.error
        )


def _finish_worker(run_id: str, worker: db.Worker, outcome: WorkerOutcome) -> None:
    if outcome.status == "failed":
        db.set_worker_failed(worker.id, outcome.error or "The worker failed.")
    else:
        db.set_worker_progress(worker.id, outcome.status, None)
    broadcaster.publish(
        run_id,
        "worker",
        {
            "worker_id": worker.id,
            "row_index": worker.row_index,
            "status": outcome.status,
            "current_step_id": None,
            "screenshot": None,
            "error": outcome.error,
        },
    )
    logger.info(
        "Worker %d finished: %s (%d/%d steps)",
        worker.row_index,
        outcome.status,
        outcome.steps_completed,
        outcome.steps_total,
    )


def _run_one(
    run_id: str, brief: dict[str, Any], slot: WorkerSandbox, worker: db.Worker
) -> None:
    """One worker, start to finish. Never raises — a worker's failure is its own."""
    try:
        db.set_worker_sandbox(worker.id, slot.sandbox_id)
        outcome = run_worker(
            slot.sandbox, brief, worker.row_data, _Reporter(run_id, worker)
        )
    except Exception as exc:
        logger.exception("Worker %d crashed", worker.row_index)
        outcome = WorkerOutcome(
            "failed", 0, len(brief["steps"]), f"{type(exc).__name__}: {exc}"
        )
    _finish_worker(run_id, worker, outcome)


def _execute(run_id: str, brief: dict[str, Any], api_key: str, snapshot: str) -> None:
    """Provision every sandbox, run all workers in parallel, then tear everything down."""
    workers = db.list_workers(run_id)
    db.mark_run_started(run_id)
    broadcaster.publish(run_id, "run", {"status": "running", "finished_at": None})

    try:
        with worker_sandboxes(api_key, snapshot, len(workers)) as slots:
            threads = [
                threading.Thread(
                    target=_run_one,
                    args=(run_id, brief, slot, worker),
                    name=f"owari-worker-{worker.row_index}",
                    daemon=True,
                )
                for slot, worker in zip(slots, workers, strict=True)
            ]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
    except ForkError as exc:
        message = str(exc)
        logger.error("Run %s could not provision: %s", run_id, message)
        for worker in db.list_workers(run_id):
            if worker.status in ("pending", "running"):
                db.set_worker_failed(worker.id, message)
                broadcaster.publish(
                    run_id,
                    "worker",
                    {
                        "worker_id": worker.id,
                        "row_index": worker.row_index,
                        "status": "failed",
                        "current_step_id": None,
                        "screenshot": None,
                        "error": message,
                    },
                )
        _close_run(run_id, "failed")
        return

    final = db.list_workers(run_id)
    status = (
        "complete"
        if all(w.status in ("complete", "skipped") for w in final)
        else "failed"
    )
    _close_run(run_id, status)


def _close_run(run_id: str, status: str) -> None:
    finished_at = db.mark_run_finished(run_id, status)
    broadcaster.publish(run_id, "run", {"status": status, "finished_at": finished_at})
    broadcaster.close(run_id)
    logger.info("Run %s finished: %s", run_id, status)


def start_run(run_id: str, brief: dict[str, Any], api_key: str, snapshot: str) -> None:
    """Launch a run on a background thread and return immediately."""
    threading.Thread(
        target=_execute,
        args=(run_id, brief, api_key, snapshot),
        name=f"owari-run-{run_id[:8]}",
        daemon=True,
    ).start()
