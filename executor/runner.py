"""The per-worker step loop: one Brief, one input row, one sandbox.

The runner owns sequencing and nothing else. Grounding is grounding.py's job, performing an
action is actions.py's job, and persistence and SSE belong to the server — which is why this
module reports through an injected `WorkerReporter` rather than importing server code. The
executor never touches the database or HTTP routing (see the boundary table in
docs/ARCHITECTURE.md).

Conditional evaluation, stated plainly because it is a real design decision: a step's
`condition.if` is plain English written for a human to read in the dashboard. Evaluating
arbitrary English would mean a model call per step, which DECISIONS.md D3 forbids — it would
make runs slow and non-deterministic. So the executor evaluates a conditional step by
whether its target is present on the current screen. Present means the condition holds and
the step runs; absent means it does not, and `else` decides whether to skip the step or end
the workflow. That is deterministic, needs no model, and produces genuine divergence: a
worker whose data leads to a different screen takes a different path.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Any, Protocol, Self

from daytona import DaytonaError, Sandbox, ScreenshotOptions

from executor.actions import ActionError, perform
from executor.grounding import (
    GroundedNode,
    GroundingError,
    NodeNotFoundError,
    describe,
    resolve_target,
)

logger = logging.getLogger("owari.executor.runner")

SCREENSHOT_INTERVAL_SECONDS = 2.5
SCREENSHOT_TIMEOUT_SECONDS = 30.0
# Compressed, small. API.md forbids full-resolution screenshots on the polling path.
SCREENSHOT_OPTIONS = ScreenshotOptions(fmt="jpeg", quality=60, scale=0.4)
RETRY_PAUSE_SECONDS = 1.5

# The one definition of a variable reference, shared with the validator so that what
# validation accepts and what execution substitutes can never diverge.
from server.brief_schema import VARIABLE_REFERENCE


class SubstitutionError(RuntimeError):
    """A step referenced a variable the input row does not supply."""


class WorkerReporter(Protocol):
    """How the runner reports progress. Implemented by the server, which owns persistence."""

    def step_started(self, step_id: int) -> None: ...

    def step_finished(
        self,
        step_id: int,
        status: str,
        duration_ms: int,
        resolved_target: dict[str, Any] | None,
        error: str | None,
    ) -> None: ...

    def screenshot(self, image_base64: str) -> None: ...


@dataclass(frozen=True)
class WorkerOutcome:
    """What became of one worker. `skipped` means a conditional ended the workflow early."""

    status: str
    steps_completed: int
    steps_total: int
    error: str | None = None


def resolve_value(
    value: str | None, row: dict[str, Any], variables: list[dict[str, Any]]
) -> str | None:
    """Replace every {{name}} in a step's value with this row's data.

    Raises rather than substituting a blank: typing "{{company}}" into a live application
    is worse than failing the step, and a missing column is a launch-time error the server
    should already have rejected.
    """
    if value is None:
        return None
    column_for = {v["name"]: v["source_column"] for v in variables}

    def replace(match: Any) -> str:
        name = match.group(1)
        column = column_for.get(name)
        if column is None:
            raise SubstitutionError(
                f"{{{{{name}}}}} is not a variable this Brief declares"
            )
        if column not in row:
            raise SubstitutionError(f"The input row has no column named {column!r}")
        return str(row[column])

    return VARIABLE_REFERENCE.sub(replace, value)


class _ScreenshotPump:
    """Sends a compressed frame every couple of seconds while a worker is running.

    API.md requires a worker event at least every 3 seconds. Screenshots run on their own
    thread so a slow step never starves the grid of frames.
    """

    def __init__(self, sandbox: Sandbox, reporter: WorkerReporter) -> None:
        self._sandbox = sandbox
        self._reporter = reporter
        self._stop = threading.Event()
        self._thread = threading.Thread(
            target=self._loop, daemon=True, name="owari-screenshots"
        )

    def __enter__(self) -> Self:
        self._thread.start()
        return self

    def __exit__(self, *_: object) -> None:
        self._stop.set()
        self._thread.join(timeout=SCREENSHOT_TIMEOUT_SECONDS)

    def capture_once(self) -> None:
        try:
            shot = self._sandbox.computer_use.screenshot.take_compressed(
                SCREENSHOT_OPTIONS, request_timeout=SCREENSHOT_TIMEOUT_SECONDS
            )
        except (DaytonaError, OSError) as exc:
            logger.debug("Screenshot failed: %s", exc)
            return
        data = getattr(shot, "screenshot", None) or getattr(shot, "data", None)
        if isinstance(data, str) and data:
            self._reporter.screenshot(data)

    def _loop(self) -> None:
        while not self._stop.is_set():
            self.capture_once()
            self._stop.wait(SCREENSHOT_INTERVAL_SECONDS)


def _ms_since(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


def _condition_holds(sandbox: Sandbox, step: dict[str, Any]) -> bool:
    """Is this conditional step's target present on the current screen?"""
    try:
        resolve_target(sandbox, step["target"])
    except NodeNotFoundError:
        return False
    return True


def _perform_with_one_retry(
    sandbox: Sandbox, step: dict[str, Any], value: str | None
) -> tuple[GroundedNode | None, bool]:
    """Perform a step, retrying once if the target was not found. Returns (node, retried)."""
    try:
        return perform(sandbox, step["action"], step["target"], value), False
    except NodeNotFoundError:
        logger.info("Target not found for step %s; retrying once", step["id"])
        time.sleep(RETRY_PAUSE_SECONDS)
        return perform(sandbox, step["action"], step["target"], value), True


def run_worker(
    sandbox: Sandbox,
    brief: dict[str, Any],
    row: dict[str, Any],
    reporter: WorkerReporter,
) -> WorkerOutcome:
    """Execute every step of a Brief against one sandbox with one input row."""
    steps: list[dict[str, Any]] = brief["steps"]
    variables: list[dict[str, Any]] = brief["variables"]
    completed = 0

    with _ScreenshotPump(sandbox, reporter) as frames:
        for step in steps:
            step_id = int(step["id"])
            reporter.step_started(step_id)
            started = time.monotonic()
            condition = step.get("condition")
            if condition is not None and not _condition_holds(sandbox, step):
                reason = (
                    f"Condition not met: {condition['if']} "
                    f"({describe(step['target'])} is not on screen)"
                )
                reporter.step_finished(
                    step_id, "skipped", _ms_since(started), None, reason
                )
                frames.capture_once()
                if condition["else"] == "end_workflow":
                    logger.info("Step %s ended the workflow early", step_id)
                    return WorkerOutcome("skipped", completed, len(steps), reason)
                continue

            try:
                value = resolve_value(step["value"], row, variables)
                node, retried = _perform_with_one_retry(sandbox, step, value)
            except (
                # GroundingError is the parent of NodeNotFoundError, and catches the cases
                # where the accessibility API itself refused the query. Those must be
                # recorded against the step like any other failure, not escape to the
                # worker as a bare error with no step_result behind it.
                GroundingError,
                ActionError,
                SubstitutionError,
                DaytonaError,
            ) as exc:
                message = str(exc)
                reporter.step_finished(
                    step_id, "failed", _ms_since(started), None, message
                )
                frames.capture_once()
                logger.warning("Worker failed at step %s: %s", step_id, message)
                return WorkerOutcome("failed", completed, len(steps), message)

            completed += 1
            reporter.step_finished(
                step_id,
                "retried" if retried else "ok",
                _ms_since(started),
                node.as_record() if node is not None else None,
                None,
            )
            frames.capture_once()

    return WorkerOutcome("complete", completed, len(steps))
