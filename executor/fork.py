"""Worker sandbox lifecycle: snapshot in, N running desktops out, every one torn down.

"Fork" in Owari means creating a sandbox from `OWARI_SNAPSHOT_NAME`, not the SDK's
`sandbox.fork()` — that method is supported for VM sandboxes only and Owari runs container
sandboxes. See the Daytona section of docs/ARCHITECTURE.md.

The teardown guarantee is the point of this module. A leaked sandbox burns real credits, so
every sandbox this module creates is deleted on the success path and on every failure path,
including a failure part-way through creating the batch. Sandboxes are additionally created
`ephemeral` with `auto_delete_interval=0`, so Daytona reaps anything that outlives a crash
of the server process itself.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from daytona import CreateSandboxFromSnapshotParams, Daytona, DaytonaError, Sandbox

from executor.daytona_client import DaytonaUnavailableError, get_client

logger = logging.getLogger("owari.executor.fork")

# The desktop resolution every worker runs at. Set on creation because it cannot be changed
# on a running sandbox, and the accessibility tree is what we act on, not pixels — but the
# recording and the run should still frame the same layout.
VNC_RESOLUTION = "1280x800"

CREATE_TIMEOUT_SECONDS = 180.0
DELETE_TIMEOUT_SECONDS = 60.0


class ForkError(RuntimeError):
    """A worker sandbox could not be created or prepared."""


@dataclass(frozen=True)
class WorkerSandbox:
    """A running, Computer-Use-ready sandbox bound to one input row."""

    row_index: int
    sandbox: Sandbox

    @property
    def sandbox_id(self) -> str:
        return self.sandbox.id


def _create_one(client: Daytona, snapshot_name: str, row_index: int) -> Sandbox:
    """Create a single sandbox from the snapshot and start its desktop."""
    params = CreateSandboxFromSnapshotParams(
        snapshot=snapshot_name,
        env_vars={"VNC_RESOLUTION": VNC_RESOLUTION},
        labels={"owari_row_index": str(row_index)},
        ephemeral=True,
        auto_delete_interval=0,
    )
    sandbox = client.create(params, timeout=CREATE_TIMEOUT_SECONDS)
    try:
        sandbox.computer_use.start()
    except DaytonaError as exc:
        # The sandbox exists but has no desktop; it is useless and must not be left running.
        destroy(sandbox)
        raise ForkError(
            f"Row {row_index}: the sandbox started but Computer Use did not. "
            f"Confirm {snapshot_name!r} was built from the Daytona default image. ({exc})"
        ) from exc
    return sandbox


def destroy(sandbox: Sandbox) -> None:
    """Delete one sandbox. Never raises — teardown must not mask the original failure."""
    try:
        sandbox.delete(timeout=DELETE_TIMEOUT_SECONDS)
        logger.info("Deleted sandbox %s", sandbox.id)
    except (DaytonaError, OSError) as exc:
        # Surfaced loudly because it costs money, but it cannot be allowed to propagate:
        # this runs in a finally block that is often already unwinding a real error.
        logger.error("LEAKED SANDBOX %s — delete failed: %s", sandbox.id, exc)


def destroy_all(workers: list[WorkerSandbox]) -> None:
    """Delete every sandbox in a batch, attempting all of them regardless of failures."""
    for worker in workers:
        destroy(worker.sandbox)


@contextmanager
def worker_sandboxes(
    api_key: str, snapshot_name: str, count: int
) -> Iterator[list[WorkerSandbox]]:
    """Create `count` sandboxes from the snapshot, guaranteeing teardown on every exit path.

    If creation fails part-way through, the sandboxes already created are destroyed before
    the error propagates — a partially created run leaves nothing behind.
    """
    if count < 1:
        raise ForkError(f"A run needs at least one worker, got {count}")
    if not snapshot_name:
        raise ForkError("OWARI_SNAPSHOT_NAME is not set in .env")

    client = get_client(api_key)
    workers: list[WorkerSandbox] = []

    # Creation and use are separated so that a Daytona error raised by the caller inside
    # the `with` block is not mistaken for — and reported as — a failure to create workers.
    try:
        for row_index in range(count):
            sandbox = _create_one(client, snapshot_name, row_index)
            workers.append(WorkerSandbox(row_index=row_index, sandbox=sandbox))
            logger.info("Worker %d ready on sandbox %s", row_index, sandbox.id)
    except (DaytonaError, DaytonaUnavailableError, ForkError) as exc:
        destroy_all(workers)
        raise ForkError(
            f"Could not create worker {len(workers) + 1} of {count} from snapshot "
            f"{snapshot_name!r}: {exc}"
        ) from exc
    except BaseException:
        destroy_all(workers)
        raise

    try:
        yield workers
    finally:
        destroy_all(workers)
