"""One function per Brief action verb, and nothing else.

Each verb takes an already-grounded target (or no target, for the keyboard verbs) and
performs exactly one interaction. Grounding lives in grounding.py, variable substitution and
the step loop live in runner.py — this module does not decide what to do, only how.

No verb here touches coordinates. `invoke_node` activates a node the accessibility tree
resolved; it never clicks a pixel.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from daytona import DaytonaError, Sandbox

from executor.grounding import GroundedNode, describe, resolve_target, wait_for_target

logger = logging.getLogger("crewmate.executor.actions")

ACTION_TIMEOUT_SECONDS = 25.0
# How long `wait_for` polls before giving up. Long enough for a page load, short enough that
# a worker stuck on a step fails inside a demo rather than hanging the run.
WAIT_FOR_TIMEOUT_SECONDS = 25.0
# Typing is per-character; a small delay keeps fast web inputs from dropping characters.
TYPE_DELAY_MS = 12


class ActionError(RuntimeError):
    """An action failed against a node that was successfully grounded."""


class UnknownActionError(ActionError):
    """The Brief names an action verb this executor does not implement."""


def invoke_node(
    sandbox: Sandbox, target: dict[str, Any], value: str | None
) -> GroundedNode:
    """Activate a control — a button, a link, a checkbox. Takes no value."""
    node = resolve_target(sandbox, target)
    try:
        sandbox.computer_use.accessibility.invoke_node(
            node.id, request_timeout=ACTION_TIMEOUT_SECONDS
        )
    except DaytonaError as exc:
        raise ActionError(f"Could not activate {describe(target)}: {exc}") from exc
    return node


def focus_node(
    sandbox: Sandbox, target: dict[str, Any], value: str | None
) -> GroundedNode:
    """Move keyboard focus to a control. Takes no value."""
    node = resolve_target(sandbox, target)
    try:
        sandbox.computer_use.accessibility.focus_node(
            node.id, request_timeout=ACTION_TIMEOUT_SECONDS
        )
    except DaytonaError as exc:
        raise ActionError(f"Could not focus {describe(target)}: {exc}") from exc
    return node


def set_node_value(
    sandbox: Sandbox, target: dict[str, Any], value: str | None
) -> GroundedNode:
    """Put text into a field, and confirm it went in.

    Two mechanisms exist. The accessibility API's set-value is atomic and cannot drop
    characters, so it is tried first — but browsers do not implement it for text inputs and
    reject it outright, and some native widgets accept the call while ignoring it. So the
    result is always read back, and if the value is not there the field is focused, cleared
    and typed, which is what the person did during the recording.

    This is one action with a verified outcome rather than a guess: it returns only when the
    field actually contains the value, and raises otherwise.
    """
    if value is None:
        raise ActionError(
            f"set_node_value on {describe(target)} requires a value, got null"
        )
    node = resolve_target(sandbox, target)
    accessibility = sandbox.computer_use.accessibility

    try:
        accessibility.set_node_value(
            node.id, value, request_timeout=ACTION_TIMEOUT_SECONDS
        )
    except DaytonaError as exc:
        logger.debug(
            "Accessibility set-value unavailable on %s: %s", describe(target), exc
        )
    else:
        if _value_of(sandbox, node) == value:
            return node

    try:
        accessibility.focus_node(node.id, request_timeout=ACTION_TIMEOUT_SECONDS)
        sandbox.computer_use.keyboard.hotkey(
            "ctrl+a", request_timeout=ACTION_TIMEOUT_SECONDS
        )
        sandbox.computer_use.keyboard.press(
            "delete", request_timeout=ACTION_TIMEOUT_SECONDS
        )
        sandbox.computer_use.keyboard.type(
            value,
            delay=TYPE_DELAY_MS,
            request_timeout=max(ACTION_TIMEOUT_SECONDS, len(value) * 0.15),
        )
    except DaytonaError as exc:
        raise ActionError(f"Could not type into {describe(target)}: {exc}") from exc

    written = _value_of(sandbox, node)
    if written is not None and written != value:
        raise ActionError(
            f"{describe(target)} holds {written[:60]!r} after typing, expected {value[:60]!r}"
        )
    return node


def press_key(sandbox: Sandbox, target: dict[str, Any], value: str | None) -> None:
    """Press a single key. The key is carried in `value`; the target is empty."""
    if not value:
        raise ActionError("press_key requires a key in `value`, got null")
    try:
        sandbox.computer_use.keyboard.press(
            value, request_timeout=ACTION_TIMEOUT_SECONDS
        )
    except DaytonaError as exc:
        raise ActionError(f"Could not press {value!r}: {exc}") from exc


def hotkey(sandbox: Sandbox, target: dict[str, Any], value: str | None) -> None:
    """Press a key combination such as 'ctrl+s'. Carried in `value`; the target is empty."""
    if not value:
        raise ActionError("hotkey requires a combination in `value`, got null")
    try:
        sandbox.computer_use.keyboard.hotkey(
            value, request_timeout=ACTION_TIMEOUT_SECONDS
        )
    except DaytonaError as exc:
        raise ActionError(f"Could not press the combination {value!r}: {exc}") from exc


def wait_for(
    sandbox: Sandbox, target: dict[str, Any], value: str | None
) -> GroundedNode:
    """Poll until the target appears. Exists so a page load is waited on, not slept through."""
    return wait_for_target(sandbox, target, WAIT_FOR_TIMEOUT_SECONDS)


def _value_of(sandbox: Sandbox, node: GroundedNode) -> str | None:
    """Read a field's current text back, to confirm a set actually took effect."""
    try:
        response = sandbox.computer_use.accessibility.find_nodes(
            scope="all",
            role=node.role or None,
            name=node.name or None,
            name_match="exact",
            limit=1,
            request_timeout=ACTION_TIMEOUT_SECONDS,
        )
    except DaytonaError:
        return None
    matches = list(response.matches or ())
    if not matches:
        return None
    extra = getattr(matches[0], "additional_properties", None) or {}
    for key in ("value", "text", "description"):
        found = extra.get(key) if isinstance(extra, dict) else None
        if isinstance(found, str):
            return found
    return None


# The Brief's action enum, mapped to the function that performs it. Every verb in
# DATA_MODEL.md appears here exactly once; a Brief naming anything else is rejected.
ACTIONS: dict[
    str, Callable[[Sandbox, dict[str, Any], str | None], GroundedNode | None]
] = {
    "invoke_node": invoke_node,
    "set_node_value": set_node_value,
    "focus_node": focus_node,
    "press_key": press_key,
    "hotkey": hotkey,
    "wait_for": wait_for,
}


def perform(
    sandbox: Sandbox, action: str, target: dict[str, Any], value: str | None
) -> GroundedNode | None:
    """Run one action verb. Returns the node it acted on, or None for keyboard verbs."""
    handler = ACTIONS.get(action)
    if handler is None:
        raise UnknownActionError(
            f"{action!r} is not an action this executor implements. "
            f"Valid actions: {', '.join(sorted(ACTIONS))}"
        )
    return handler(sandbox, target, value)
