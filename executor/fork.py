"""Worker sandbox lifecycle: snapshot in, N running desktops out, every one torn down.

"Fork" in Crewmate means creating a sandbox from `CREWMATE_SNAPSHOT_NAME`, not the SDK's
`sandbox.fork()` — that method is supported for VM sandboxes only and Crewmate runs container
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
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass

from daytona import (
    CreateSandboxFromSnapshotParams,
    Daytona,
    DaytonaError,
    ListSandboxesQuery,
    Sandbox,
)

from executor.daytona_client import DaytonaUnavailableError, get_client

logger = logging.getLogger("crewmate.executor.fork")

# The desktop resolution every worker runs at. Set on creation because it cannot be changed
# on a running sandbox, and the accessibility tree is what we act on, not pixels — but the
# recording and the run should still frame the same layout.
VNC_RESOLUTION = "1280x800"

CREATE_TIMEOUT_SECONDS = 180.0
# Marks every sandbox this module creates, so orphans can be told apart from anything else
# in the organisation and reaped without touching a stranger's machine.
OWNER_LABEL = "crewmate_worker"
RUN_LABEL = "crewmate_run_id"
DELETE_TIMEOUT_SECONDS = 60.0

# Runs currently provisioning or executing in this process. Their sandboxes are never
# reaped, however many other runs start while they are working.
_active_run_ids: set[str] = set()


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


def _create_one(
    client: Daytona, snapshot_name: str, run_id: str, row_index: int
) -> Sandbox:
    """Create a single sandbox from the snapshot and start its desktop."""
    params = CreateSandboxFromSnapshotParams(
        snapshot=snapshot_name,
        env_vars={"VNC_RESOLUTION": VNC_RESOLUTION},
        labels={
            OWNER_LABEL: "true",
            RUN_LABEL: run_id,
            "crewmate_row_index": str(row_index),
        },
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


def reap_orphans(api_key: str, exclude_run_id: str = "") -> int:
    """Delete sandboxes left behind by a *finished* run, and report how many.

    Teardown is guaranteed on every normal path, but a hard kill of the server process
    leaves machines running, and on a small tier those orphans consume the whole memory
    quota. The next launch then fails with a message about limits that says nothing about
    the real cause, so provisioning reaps first.

    `exclude_run_id` is what stops this eating a run that is still going. Every sandbox
    carries the id of the run that created it; a run never reaps its own, and callers pass
    the id of any run they know to be live. Without that guard, launching a second run
    destroyed the first one's machines mid-step and reported "sandbox not found" — a failure
    with no relationship to the actual cause.
    """
    try:
        client = get_client(api_key)
        candidates = list(client.list(ListSandboxesQuery(labels={OWNER_LABEL: "true"})))
    except (DaytonaError, DaytonaUnavailableError) as exc:
        logger.warning("Could not check for orphaned sandboxes: %s", exc)
        return 0

    reaped = 0
    for sandbox in candidates:
        labels = getattr(sandbox, "labels", None) or {}
        if exclude_run_id and labels.get(RUN_LABEL) == exclude_run_id:
            continue
        if labels.get(RUN_LABEL) in _active_run_ids:
            logger.debug("Leaving sandbox %s alone; its run is still going", sandbox.id)
            continue
        logger.warning("Reaping orphaned sandbox %s from a previous run", sandbox.id)
        destroy(sandbox)
        reaped += 1
    return reaped


def destroy_run(api_key: str, run_id: str) -> int:
    """Destroy every sandbox belonging to one run. Used when an operator stops it."""
    try:
        client = get_client(api_key)
        owned = list(client.list(ListSandboxesQuery(labels={RUN_LABEL: run_id})))
    except (DaytonaError, DaytonaUnavailableError) as exc:
        logger.warning("Could not list sandboxes for run %s: %s", run_id, exc)
        return 0
    for sandbox in owned:
        destroy(sandbox)
    _active_run_ids.discard(run_id)
    return len(owned)


@contextmanager
def worker_sandboxes(
    api_key: str, snapshot_name: str, count: int, run_id: str = ""
) -> Iterator[list[WorkerSandbox]]:
    """Create `count` sandboxes from the snapshot, guaranteeing teardown on every exit path.

    If creation fails part-way through, the sandboxes already created are destroyed before
    the error propagates — a partially created run leaves nothing behind.
    """
    if count < 1:
        raise ForkError(f"A run needs at least one worker, got {count}")
    if not snapshot_name:
        raise ForkError("CREWMATE_SNAPSHOT_NAME is not set in .env")

    _active_run_ids.add(run_id)
    reaped = reap_orphans(api_key, exclude_run_id=run_id)
    if reaped:
        logger.info("Reclaimed %d orphaned sandbox(es) before provisioning", reaped)

    client = get_client(api_key)
    workers: list[WorkerSandbox] = []

    # Provisioning is the single largest cost in a run — a sandbox takes tens of seconds to
    # boot, and doing them one after another meant the grid sat empty for that time
    # multiplied by the worker count. They are created concurrently instead; the wall clock
    # is now roughly one sandbox regardless of how many are launched.
    #
    # Creation and use stay separated so that a Daytona error raised by the caller inside the
    # `with` block is not mistaken for — and reported as — a failure to create workers.
    try:
        with ThreadPoolExecutor(
            max_workers=count, thread_name_prefix="crewmate-provision"
        ) as pool:
            futures = {
                pool.submit(
                    _create_one, client, snapshot_name, run_id, row_index
                ): row_index
                for row_index in range(count)
            }
            # Every future is resolved before anything is raised. Bailing out on the first
            # error would leave sandboxes created by the others unreferenced, and an
            # unreferenced sandbox is a leak that costs money — the exact failure this
            # module exists to prevent.
            failure: BaseException | None = None
            for future, row_index in futures.items():
                try:
                    sandbox = future.result()
                except BaseException as exc:  # noqa: BLE001 — recorded, re-raised below
                    failure = failure or exc
                    continue
                workers.append(WorkerSandbox(row_index=row_index, sandbox=sandbox))
                logger.info("Worker %d ready on sandbox %s", row_index, sandbox.id)
        if failure is not None:
            raise failure
        workers.sort(key=lambda worker: worker.row_index)
    except (DaytonaError, DaytonaUnavailableError, ForkError) as exc:
        destroy_all(workers)
        raise ForkError(
            f"Could not create {count} worker(s) from snapshot {snapshot_name!r}: {exc}"
        ) from exc
    except BaseException:
        destroy_all(workers)
        raise

    try:
        yield workers
    finally:
        destroy_all(workers)
        _active_run_ids.discard(run_id)
