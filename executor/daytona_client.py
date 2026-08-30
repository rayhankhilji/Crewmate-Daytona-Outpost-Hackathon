"""The only file in the system that constructs a Daytona client.

Per ARCHITECTURE.md D5, `executor/` is the sole importer of the `daytona` SDK. Anything
outside this package that needs Daytona routes through the executor's public functions.
"""

from __future__ import annotations

import logging

from daytona import Daytona, DaytonaConfig, DaytonaError, ListSandboxesQuery

logger = logging.getLogger("owari.executor")

REACHABILITY_TIMEOUT_SECONDS = 5.0

_client: Daytona | None = None
_client_api_key: str | None = None


class DaytonaUnavailableError(RuntimeError):
    """The Daytona API could not be reached or authenticated."""


def get_client(api_key: str) -> Daytona:
    """Return the process-wide Daytona client, constructing it on first use.

    The client is cached because construction opens an event-stream connection; rebuilding
    it per call would leak connections across a run.
    """
    global _client, _client_api_key
    if not api_key:
        raise DaytonaUnavailableError("DAYTONA_API_KEY is not set in .env")
    if _client is not None and _client_api_key == api_key:
        return _client
    try:
        _client = Daytona(DaytonaConfig(api_key=api_key))
    except DaytonaError as exc:
        raise DaytonaUnavailableError(
            f"Could not construct a Daytona client: {exc}"
        ) from exc
    _client_api_key = api_key
    return _client


def check_reachable(api_key: str) -> bool:
    """Make one cheap authenticated call to confirm the Daytona API answers.

    Returns False rather than raising: /health reports reachability as a field, and a
    missing key is a degraded state there, not a request failure. Every path that performs
    real work calls the Daytona API directly and surfaces its error.
    """
    if not api_key:
        return False
    try:
        client = get_client(api_key)
        next(
            client.list(
                ListSandboxesQuery(limit=1),
                request_timeout=REACHABILITY_TIMEOUT_SECONDS,
            ),
            None,
        )
    except (DaytonaError, DaytonaUnavailableError, OSError) as exc:
        logger.warning("Daytona unreachable: %s", exc)
        return False
    return True
