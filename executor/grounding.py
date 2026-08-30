"""Brief step target -> a live accessibility node inside a running sandbox.

This is the single most important idea in Crewmate. A Brief never carries coordinates; it
carries a semantic target (role + name), and this module re-resolves that target against
the accessibility tree of the machine the worker is actually looking at. That is what lets
a recording made on a Mac at one resolution execute on a Linux sandbox at another.

There is deliberately no coordinate path here. `bounds` is present on every node the API
returns and is never read. If a target cannot be resolved, this module raises — it does not
guess, and it does not fall back to clicking a pixel.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

from daytona import DaytonaError, Sandbox

logger = logging.getLogger("crewmate.executor.grounding")

# "all" searches every application on the desktop rather than only the focused one, which is
# what a Brief step means: find this control wherever it is on screen.
DEFAULT_SCOPE = "all"
# Enough matches to detect ambiguity and report it, without pulling a whole tree back.
MATCH_LIMIT = 10
FIND_TIMEOUT_SECONDS = 20.0
WAIT_POLL_SECONDS = 0.75


class GroundingError(RuntimeError):
    """A step target could not be turned into a node."""


class NodeNotFoundError(GroundingError):
    """No node on the current screen matches the step's role and name."""


class UngroundableTargetError(GroundingError):
    """The target carries neither a role nor a name, so it cannot be searched for."""


@dataclass(frozen=True)
class GroundedNode:
    """A node resolved at run time. Serialised into step_results.resolved_target."""

    id: str
    role: str
    name: str
    actions: tuple[str, ...]
    states: tuple[str, ...]
    match_count: int

    def as_record(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "role": self.role,
            "name": self.name,
            "actions": list(self.actions),
            "states": list(self.states),
            "match_count": self.match_count,
        }


def describe(target: dict[str, Any]) -> str:
    """Human-readable target, used in every error message a person will read."""
    role = target.get("role") or "?"
    name = target.get("name") or ""
    match = target.get("name_match") or "exact"
    return f"{role} named {name!r} ({match} match)"


def _to_node(match: Any, match_count: int) -> GroundedNode:
    node_id = getattr(match, "id", None)
    if not node_id:
        raise GroundingError("The accessibility API returned a match with no node id")
    return GroundedNode(
        id=node_id,
        role=getattr(match, "role", "") or "",
        name=getattr(match, "name", "") or "",
        actions=tuple(getattr(match, "actions", None) or ()),
        states=tuple(getattr(match, "states", None) or ()),
        match_count=match_count,
    )


# Roles that describe a container the real control sits inside. A match on one of these is
# accepted, but ranked below a match on the control itself.
_CONTAINER_ROLES = frozenset(
    {"table cell", "section", "panel", "filler", "list item", "static"}
)


def _rank(match: Any, wanted_role: str) -> tuple[int, int]:
    """Rank a candidate: exact role first, then a real control, then anything else."""
    role = (getattr(match, "role", "") or "").lower()
    wanted = wanted_role.lower()
    if role == wanted:
        return (0, 0)
    if role and wanted and (role in wanted or wanted in role):
        return (1, 0)
    if role in _CONTAINER_ROLES:
        return (3, 0)
    return (2, 0)


def resolve_target(sandbox: Sandbox, target: dict[str, Any]) -> GroundedNode:
    """Find the node a step's target refers to on the sandbox's current screen.

    Matching is by accessible **name**, with `role` used to rank candidates rather than to
    filter them. That is deliberate. A Brief is written by a model looking at pixels, which
    can read a control's label but cannot know whether the page implemented it as a `link`,
    a `push button` or a `table cell` — those are markup details invisible on screen. The
    same button is a different role in two applications that look identical. Requiring an
    exact role match would make grounding fail on correct Briefs.

    The name still has to match exactly as the step specifies, so this is not loose matching:
    it is matching on the part of the target that is actually observable.

    Raises NodeNotFoundError if no node carries that name. When several do, the best-ranked
    is used and the count is recorded, so an ambiguous target is visible in the results
    rather than silently guessed at.
    """
    role = (target.get("role") or "").strip()
    name = (target.get("name") or "").strip()
    if not role and not name:
        raise UngroundableTargetError(
            "This target has no role and no name. press_key and hotkey steps carry their "
            "key in `value` and must not be grounded."
        )
    if not name:
        raise UngroundableTargetError(
            f"This target names no control, only the role {role!r}. A Brief step must "
            f"identify the control by its accessible name."
        )

    try:
        response = sandbox.computer_use.accessibility.find_nodes(
            scope=DEFAULT_SCOPE,
            name=name,
            name_match=target.get("name_match") or "exact",
            limit=MATCH_LIMIT,
            request_timeout=FIND_TIMEOUT_SECONDS,
        )
    except DaytonaError as exc:
        raise GroundingError(
            f"Accessibility lookup failed for {describe(target)}: {exc}"
        ) from exc

    matches = list(response.matches or ())
    if not matches:
        raise NodeNotFoundError(f"No node on screen matches {describe(target)}")

    ranked = sorted(matches, key=lambda m: _rank(m, role))
    best = ranked[0]
    best_role = (getattr(best, "role", "") or "").lower()
    if role and best_role != role.lower():
        logger.info(
            "%s resolved to a %r node — role is a hint, the name is the identity",
            describe(target),
            best_role,
        )
    if len(matches) > 1:
        logger.info("%d nodes are named %r; using the best-ranked", len(matches), name)
    return _to_node(best, len(matches))


def wait_for_target(
    sandbox: Sandbox, target: dict[str, Any], timeout_seconds: float
) -> GroundedNode:
    """Poll until the target appears, or raise once the timeout is spent.

    This exists so the executor can wait on a page load without sleeping blindly, which is
    what the Brief's `wait_for` action means.
    """
    deadline = time.monotonic() + timeout_seconds
    attempts = 0
    while True:
        attempts += 1
        try:
            return resolve_target(sandbox, target)
        except NodeNotFoundError:
            if time.monotonic() >= deadline:
                raise NodeNotFoundError(
                    f"{describe(target)} did not appear within {timeout_seconds:.0f}s "
                    f"({attempts} attempts)"
                ) from None
            time.sleep(WAIT_POLL_SECONDS)
