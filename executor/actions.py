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
WAIT_FOR_TIMEOUT_SECONDS = 45.0
# Typing is per-character. 12ms was cautious and cost 8 seconds on a 400-character
# report; 5ms measured clean on the same field and halves the slowest step in a run.
TYPE_DELAY_MS = 5

# Recordings are made on a Mac and executed on Linux. Cmd does not exist there, and a Brief
# that says "cmd+v" means "the paste shortcut", not "the key labelled cmd". Translating at
# execution time is the same principle as re-grounding a target rather than replaying a
# coordinate: the platform detail is not part of the intent.
_MODIFIER_ALIASES = {
    "cmd": "ctrl",
    "command": "ctrl",
    "meta": "ctrl",
    "super": "ctrl",
    "option": "alt",
}


def normalise_keys(value: str) -> str:
    """Rewrite a recorded key combination for the platform the worker runs on."""
    parts = [
        part.strip().lower()
        for part in value.replace("-", "+").split("+")
        if part.strip()
    ]
    translated = [_MODIFIER_ALIASES.get(part, part) for part in parts]
    # A chord can end up with the same modifier twice (cmd+ctrl+c); keep the first of each.
    seen: list[str] = []
    for part in translated:
        if part not in seen:
            seen.append(part)
    return "+".join(seen)


class ActionError(RuntimeError):
    """An action failed against a node that was successfully grounded."""


class UnknownActionError(ActionError):
    """The Brief names an action verb this executor does not implement."""


def invoke_node(
    sandbox: Sandbox, target: dict[str, Any], value: str | None
) -> GroundedNode:
    """Activate a control — a button, a link, a checkbox. Takes no value."""
    node = resolve_target(sandbox, target, "invoke_node")
    try:
        sandbox.computer_use.accessibility.invoke_node(
            node.id, request_timeout=ACTION_TIMEOUT_SECONDS
        )
    except DaytonaError as exc:
        raise ActionError(f"Could not activate {describe(target)}: {exc}") from exc
    return node


def _give_keyboard_focus(
    sandbox: Sandbox, node: GroundedNode, target: dict[str, Any]
) -> None:
    """Put the caret in a field so that typing reaches it.

    The accessibility focus call does not work on web content — it was observed leaving
    focus on the window manager while the field stayed inert, so everything typed afterwards
    went nowhere and the step still reported success over an empty record. Clicking the node
    is what actually focuses it. The click uses the node's own position, read from the live
    tree after the target was resolved by name; no coordinate comes from the recording.
    """
    try:
        sandbox.computer_use.accessibility.focus_node(
            node.id, request_timeout=ACTION_TIMEOUT_SECONDS
        )
    except DaytonaError as exc:
        logger.debug("Accessibility focus unavailable on %s: %s", describe(target), exc)

    if node.centre is None:
        raise ActionError(
            f"{describe(target)} reports no position on screen, so it cannot be focused."
        )
    try:
        sandbox.computer_use.mouse.click(
            node.centre[0], node.centre[1], request_timeout=ACTION_TIMEOUT_SECONDS
        )
    except DaytonaError as exc:
        raise ActionError(
            f"Could not click {describe(target)} to focus it: {exc}"
        ) from exc


def focus_node(
    sandbox: Sandbox, target: dict[str, Any], value: str | None
) -> GroundedNode:
    """Move keyboard focus to a control. Takes no value."""
    node = resolve_target(sandbox, target, "focus_node")
    _give_keyboard_focus(sandbox, node, target)
    return node


def set_node_value(
    sandbox: Sandbox, target: dict[str, Any], value: str | None
) -> GroundedNode:
    """Put text into a field the way a person would: focus it, clear it, and type.

    The accessibility API has a set-value call and it is tempting, because it is atomic and
    instant. It is also wrong here, and wrong in a way that reports success: on a browser it
    updates the accessible value without dispatching the input events the page listens for,
    so the application's own state never changes. A form filled that way submits empty and
    the worker records a completed step over a record it did not write.

    That was observed directly — a run reported 13 of 13 steps complete while the database
    behind the page stayed untouched. Typing produces real key events, which is what the
    recording did and what the page understands.
    """
    if value is None:
        raise ActionError(
            f"set_node_value on {describe(target)} requires a value, got null"
        )
    node = resolve_target(sandbox, target, "set_node_value")
    keyboard = sandbox.computer_use.keyboard
    _give_keyboard_focus(sandbox, node, target)
    try:
        keyboard.hotkey("ctrl+a", request_timeout=ACTION_TIMEOUT_SECONDS)
        keyboard.press("delete", request_timeout=ACTION_TIMEOUT_SECONDS)
        keyboard.type(
            value,
            delay=TYPE_DELAY_MS,
            request_timeout=max(ACTION_TIMEOUT_SECONDS, len(value) * 0.15),
        )
    except DaytonaError as exc:
        raise ActionError(f"Could not type into {describe(target)}: {exc}") from exc
    return node


def press_key(sandbox: Sandbox, target: dict[str, Any], value: str | None) -> None:
    """Press a single key. The key is carried in `value`; the target is empty."""
    if not value:
        raise ActionError("press_key requires a key in `value`, got null")
    key = normalise_keys(value)
    try:
        sandbox.computer_use.keyboard.press(key, request_timeout=ACTION_TIMEOUT_SECONDS)
    except DaytonaError as exc:
        raise ActionError(f"Could not press {key!r}: {exc}") from exc


def hotkey(sandbox: Sandbox, target: dict[str, Any], value: str | None) -> None:
    """Press a key combination such as 'ctrl+s'. Carried in `value`; the target is empty."""
    if not value:
        raise ActionError("hotkey requires a combination in `value`, got null")
    chord = normalise_keys(value)
    if chord != value.strip().lower():
        logger.info(
            "Translated recorded chord %r to %r for this platform", value, chord
        )
    try:
        sandbox.computer_use.keyboard.hotkey(
            chord, request_timeout=ACTION_TIMEOUT_SECONDS
        )
    except DaytonaError as exc:
        raise ActionError(f"Could not press the combination {chord!r}: {exc}") from exc


def wait_for(
    sandbox: Sandbox, target: dict[str, Any], value: str | None
) -> GroundedNode:
    """Poll until the target appears. Exists so a page load is waited on, not slept through."""
    return wait_for_target(sandbox, target, WAIT_FOR_TIMEOUT_SECONDS, "wait_for")


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
