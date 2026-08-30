"""The one and only Brief validator.

Every write path that persists a Brief calls `validate_brief` — the comprehension result,
`PATCH /briefs/{id}`, and the run launcher. No other module validates a Brief; a second
implementation would let the two drift apart, and the contract is what the three modules
agree on. The schema itself is frozen at contract/brief.schema.json and read, never edited.

Validation runs in two passes. The first is the frozen JSON Schema, which owns shape. The
second enforces two rules DATA_MODEL.md states in prose that JSON Schema cannot express,
and which the executor depends on for correctness:

  * step ids are unique — step_results are keyed by step_id, so a duplicate makes a
    worker's history ambiguous;
  * every {{reference}} in a step value names a declared variable — otherwise substitution
    at run time would type a literal "{{foo}}" into the target application.

Both are rejections, never repairs.
"""

from __future__ import annotations

import json
import re
from typing import Any

from jsonschema import Draft7Validator
from jsonschema.exceptions import ValidationError, best_match

from server.config import PROJECT_ROOT

SCHEMA_PATH = PROJECT_ROOT / "contract" / "brief.schema.json"

# The one definition of a variable reference. executor/runner.py substitutes with this same
# pattern, so what validation accepts and what execution replaces cannot drift apart.
VARIABLE_REFERENCE = re.compile(r"\{\{(.*?)\}\}")


class BriefValidationError(ValueError):
    """A Brief failed schema validation. The message names the failing path."""


def _load_validator() -> Draft7Validator:
    """Load the frozen contract once, failing loudly if it is missing or malformed."""
    if not SCHEMA_PATH.is_file():
        raise FileNotFoundError(
            f"The frozen Brief contract is missing at {SCHEMA_PATH}"
        )
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    Draft7Validator.check_schema(schema)
    return Draft7Validator(schema)


_validator = _load_validator()


def _format_path(error: ValidationError) -> str:
    """Render a JSON pointer as the dotted path a human would write: steps[6].target."""
    path = ""
    for part in error.absolute_path:
        if isinstance(part, int):
            path += f"[{part}]"
        else:
            path += f".{part}" if path else str(part)
    return path or "brief"


def _check_unique_step_ids(steps: list[dict[str, Any]]) -> None:
    """DATA_MODEL.md: step ids are 1-based, unique, sequential. Uniqueness is load-bearing."""
    seen: dict[int, int] = {}
    for index, step in enumerate(steps):
        step_id = step["id"]
        if step_id in seen:
            raise BriefValidationError(
                f"steps[{index}].id: duplicate step id {step_id}, already used by "
                f"steps[{seen[step_id]}]"
            )
        seen[step_id] = index


def _check_variable_references(brief: dict[str, Any]) -> None:
    """Every {{reference}} in a step value must name a variable the Brief declares."""
    declared = {variable["name"] for variable in brief["variables"]}
    for index, step in enumerate(brief["steps"]):
        value = step["value"]
        if value is None:
            continue
        for reference in VARIABLE_REFERENCE.findall(value):
            if reference not in declared:
                known = ", ".join(sorted(declared)) or "none"
                raise BriefValidationError(
                    f"steps[{index}].value: references {{{{{reference}}}}}, which is not a "
                    f"declared variable (declared: {known})"
                )


def validate_brief(content: object) -> dict[str, Any]:
    """Validate a Brief against the frozen contract and return it unchanged.

    Raises BriefValidationError naming the specific failing path. Never repairs, coerces,
    or partially accepts a Brief — a Brief is valid or it is rejected.
    """
    if not isinstance(content, dict):
        raise BriefValidationError(
            f"brief: expected a JSON object, got {type(content).__name__}"
        )
    error = best_match(_validator.iter_errors(content))
    if error is not None:
        raise BriefValidationError(f"{_format_path(error)}: {error.message}")
    _check_unique_step_ids(content["steps"])
    _check_variable_references(content)
    return content
