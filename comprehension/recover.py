"""Repair a failed step by looking at what is actually on screen.

The plan a Brief carries is compiled once and replayed deterministically — that is what makes
a run fast and repeatable, and DECISIONS.md D3 keeps the model off the execution hot path
for exactly that reason. This module is the exception D3 always allowed: the model is asked
for help *only* when a step has already failed.

The failure modes this exists for are real ones, seen in live runs:

  * a control the model described from pixels whose accessible name differs slightly
    ("Open" when the page exposes "Open Airbnb"),
  * a target that is ambiguous because the recording did not narrow the screen the way the
    row data implies (thirty rows, thirty controls named "Open"),
  * a page that had not finished rendering when the step ran.

It is given the step, the real error, a screenshot, and the list of controls currently on
screen, and returns a replacement *semantic target* — role and name — or None. It can never
return coordinates: the schema in `contract/` has no field for them, and neither does this.

A run where nothing fails calls this zero times.
"""

from __future__ import annotations

import json
import os
from typing import Any

from openai import OpenAI

MAX_CANDIDATES = 40
NAME_MATCHES = ("exact", "substring")

PROMPT = """A browser automation step just failed. Your job is to look at what is actually \
on screen and choose the control the step was meant to act on.

THE STEP THAT FAILED
  intent: {intent}
  action: {action}
  it looked for: role={role!r} name={name!r} match={name_match!r}
  the error was: {error}

CONTROLS CURRENTLY ON SCREEN (role and accessible name):
{candidates}

Pick the single control from that list which best fulfils the step's stated intent.

Rules:
- Reply with JSON only: {{"role": "...", "name": "...", "name_match": "exact"}}
- `name` MUST be copied character for character from the list above. Do not invent, \
abbreviate, correct, or reword it.
- Prefer the control whose meaning matches the intent, not merely one whose text is similar. \
A heading that says "Save" is not the Save button.
- If the intent mentions a specific record, company or person, prefer the control belonging \
to that one rather than the first of many similar controls.
- Ignore the browser's own interface and the desktop unless the intent is explicitly about \
them: tabs, the address bar, bookmarks, window controls, taskbar buttons and application \
menus are not the page. A step about a record means a control inside the page.
- Prefer the shortest name that fulfils the intent. "Open" is a different control from \
"Open tab in split view".
- If nothing on screen plausibly fulfils the intent — including when the page looks like the \
wrong page entirely — reply exactly: {{"target": null}}
- Never guess. A wrong control acts on live data. Declining is the safe answer.
"""


class RecoveryUnavailableError(RuntimeError):
    """Recovery was asked for but cannot run — usually a missing VISION_MODEL."""


def _format_candidates(candidates: list[dict[str, Any]]) -> str:
    if not candidates:
        return "  (nothing named is visible on screen)"
    lines = []
    for candidate in candidates[:MAX_CANDIDATES]:
        role = str(candidate.get("role", "")).strip() or "?"
        name = str(candidate.get("name", "")).strip()
        lines.append(f"  - role={role!r} name={name!r}")
    return "\n".join(lines)


def _parse(reply: str, candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Read the model's choice, and refuse anything not actually on screen."""
    text = reply.strip()
    if text.startswith("```"):
        text = text.split("```")[1].removeprefix("json").strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict) or parsed.get("target", "missing") is None:
        return None

    name = parsed.get("name")
    role = parsed.get("role", "")
    if not isinstance(name, str) or not name.strip():
        return None

    # The model may only choose from what the worker can see. Anything else is a
    # hallucinated control, and acting on it would be worse than failing the step.
    visible = {str(c.get("name", "")).strip() for c in candidates}
    if name.strip() not in visible:
        return None

    match = parsed.get("name_match", "exact")
    return {
        "role": str(role).strip(),
        "name": name.strip(),
        "name_match": match if match in NAME_MATCHES else "exact",
    }


def recover_step(
    *,
    step: dict[str, Any],
    error: str,
    screenshot_base64: str | None,
    candidates: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Choose a replacement target for a failed step, or None to give up.

    Returning None is a normal outcome, not an error: the executor then retries the original
    target once and fails honestly if that does not work either.
    """
    model = os.environ.get("VISION_MODEL", "").strip()
    if not model:
        raise RecoveryUnavailableError("VISION_MODEL is not set.")
    if not candidates:
        return None

    target = step.get("target") or {}
    prompt = PROMPT.format(
        intent=step.get("intent", ""),
        action=step.get("action", ""),
        role=target.get("role", ""),
        name=target.get("name", ""),
        name_match=target.get("name_match", "exact"),
        error=error,
        candidates=_format_candidates(candidates),
    )

    content: list[dict[str, str]] = [{"type": "input_text", "text": prompt}]
    if screenshot_base64:
        content.append(
            {
                "type": "input_image",
                "image_url": f"data:image/jpeg;base64,{screenshot_base64}",
                "detail": "high",
            }
        )

    response = OpenAI().responses.create(
        model=model,
        input=[{"role": "user", "content": content}],
        store=False,
    )
    return _parse(response.output_text or "", candidates)
