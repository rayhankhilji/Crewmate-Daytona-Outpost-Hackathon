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
    """A node resolved at run time. Serialised into step_results.resolved_target.

    `centre` is where this node sits on screen *at this moment*, derived from the live
    accessibility tree. That is not a violation of the no-coordinates rule: the rule exists
    because a coordinate recorded on one machine is meaningless on another, and these are
    read from the machine the worker is looking at, after the target was found by name. The
    Brief still carries no coordinate and cannot.
    """

    id: str
    role: str
    name: str
    actions: tuple[str, ...]
    states: tuple[str, ...]
    match_count: int
    centre: tuple[int, int] | None = None

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


def _centre_of(match: Any) -> tuple[int, int] | None:
    """Where the node is on screen right now, if the tree reports it."""
    bounds = getattr(match, "bounds", None)
    if bounds is None:
        return None
    try:
        x, y = int(bounds.x), int(bounds.y)
        width, height = int(bounds.width), int(bounds.height)
    except (AttributeError, TypeError, ValueError):
        return None
    if width <= 0 or height <= 0:
        return None
    return (x + width // 2, y + height // 2)


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
        centre=_centre_of(match),
    )


# Roles that describe a container the real control sits inside. A match on one of these is
# accepted, but ranked below a match on the control itself.
_CONTAINER_ROLES = frozenset({"table cell", "section", "panel", "filler", "list item"})

# The desktop and the browser's own furniture. Legitimate targets for a workflow that really
# uses them, so never excluded — but when a page control and a piece of browser chrome share
# a name, the page is what the recording meant.
_CHROME_ROLES = frozenset(
    {"toggle button", "menu item", "menu", "tool bar", "frame", "window"}
)

# Text that describes a control rather than being one. A form field and its own <label> or
# heading carry the same accessible name, so "Research notes" matches both the textarea and
# the heading above it. Typing into the heading silently does nothing — the keystrokes go to
# the window manager and the step still reports success. Which of the two is correct depends
# entirely on what the step is trying to do.
_STATIC_ROLES = frozenset(
    {"heading", "label", "static", "paragraph", "text frame", "caption"}
)

# What each action needs a node to actually be capable of.
_EDITABLE_ROLES = frozenset(
    {"entry", "text", "textbox", "combo box", "spin button", "password text"}
)
_CLICKABLE_ROLES = frozenset(
    {
        "push button",
        "button",
        "link",
        "check box",
        "radio button",
        "menu item",
        "toggle button",
        "tab",
    }
)
_ACTION_ROLES: dict[str, frozenset[str]] = {
    "set_node_value": _EDITABLE_ROLES,
    "focus_node": _EDITABLE_ROLES,
    "invoke_node": _CLICKABLE_ROLES,
}


def _rank(
    match: Any, wanted_role: str, wanted_name: str, action: str
) -> tuple[int, ...]:
    """Order candidates: capable of the action, closest name, page over chrome, real control.

    Capability comes first and was learned from a silent failure. A step typing into
    `textbox "Research notes"` resolved to the *heading* with that name, because both matched
    equally well. The keystrokes went nowhere, the step reported success, and the record was
    saved empty — a green run that did no work. A node that cannot perform the action is now
    ranked last whatever else it has going for it.
    """
    role = (getattr(match, "role", "") or "").lower()
    name = (getattr(match, "name", "") or "").strip()
    wanted = wanted_role.lower()

    capable_roles = _ACTION_ROLES.get(action)
    if capable_roles is None:
        # wait_for and the keyboard verbs only care that something is there.
        capability = 0
    elif role in capable_roles:
        capability = 0
    elif role in _STATIC_ROLES:
        capability = 2
    else:
        capability = 1

    exactness = 0 if name.casefold() == wanted_name.casefold() else 1
    chrome = 1 if role in _CHROME_ROLES else 0

    if role == wanted:
        role_rank = 0
    elif role and wanted and (role in wanted or wanted in role):
        role_rank = 1
    elif role in _CONTAINER_ROLES:
        role_rank = 3
    else:
        role_rank = 2

    return (capability, exactness, chrome, role_rank, len(name))


def resolve_target(
    sandbox: Sandbox, target: dict[str, Any], action: str = ""
) -> GroundedNode:
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

    ranked = sorted(matches, key=lambda m: _rank(m, role, name, action))
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


def visible_candidates(sandbox: Sandbox, limit: int = 40) -> list[dict[str, Any]]:
    """Every named control on screen right now, as plain dicts.

    This is the evidence handed to the recovery model when a step fails: what the worker can
    actually see, in the same role/name vocabulary a Brief target uses. Bounds are not
    included — a recovered target is still semantic.
    """
    try:
        response = sandbox.computer_use.accessibility.find_nodes(
            scope=DEFAULT_SCOPE, limit=limit, request_timeout=FIND_TIMEOUT_SECONDS
        )
    except DaytonaError as exc:
        logger.warning("Could not read the screen for recovery: %s", exc)
        return []
    seen: set[tuple[str, str]] = set()
    candidates: list[dict[str, Any]] = []
    for match in response.matches or ():
        role = (getattr(match, "role", "") or "").strip()
        name = (getattr(match, "name", "") or "").strip()
        if not name or (role, name) in seen:
            continue
        seen.add((role, name))
        candidates.append({"role": role, "name": name})
    return candidates


def wait_for_target(
    sandbox: Sandbox, target: dict[str, Any], timeout_seconds: float, action: str = ""
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
            return resolve_target(sandbox, target, action)
        except NodeNotFoundError:
            if time.monotonic() >= deadline:
                raise NodeNotFoundError(
                    f"{describe(target)} did not appear within {timeout_seconds:.0f}s "
                    f"({attempts} attempts)"
                ) from None
            time.sleep(WAIT_POLL_SECONDS)
