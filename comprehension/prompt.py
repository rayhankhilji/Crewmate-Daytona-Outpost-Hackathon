from __future__ import annotations

import json
from collections.abc import Iterable
from pathlib import Path

from comprehension.frames import SampledFrame

CONTRACT_PATH = Path(__file__).resolve().parents[1] / "contract" / "brief.schema.json"


def build_vision_prompt(
    task_name: str,
    frames: Iterable[SampledFrame],
    *,
    validation_error: str | None = None,
) -> str:
    """Build the instruction accompanying timestamped recording frames."""

    if not task_name.strip():
        raise ValueError("A task name is required to build a comprehension prompt.")

    frame_timestamps = ", ".join(f"{frame.timestamp_seconds:.3f}s" for frame in frames)
    retry_instruction = ""
    if validation_error is not None:
        retry_instruction = (
            "\nYour previous response was invalid. Return a complete replacement object, not a repair or "
            "an explanation. The validation failure was:\n"
            f"{validation_error}\n"
        )

    return (
        "You are Crewmate's workflow-comprehension engine. Review the recording frames in chronological order "
        "and infer the user's intended reusable workflow, rather than transcribing every interaction. "
        "Return ONLY one JSON object, with no Markdown fence, commentary, or explanation. "
        f"The user named the task: {task_name.strip()!r}.\n\n"
        "The attached frames have these source timestamps, in the same order: "
        f"{frame_timestamps}. Use them to place pruned segments' at_seconds values.\n\n"
        "NON-NEGOTIABLE TARGET RULE: Every step target must be semantic accessibility data only: role, "
        "name, and name_match. Never emit a pixel coordinate, bounding box, point, x, y, screen position, "
        "or any other spatial field anywhere in the Brief. Use an empty target with role='', name='', and "
        "name_match='exact' for press_key and hotkey.\n\n"
        "WORKFLOW INFERENCE RULES:\n"
        "- Prune a segment when the operator's actions produced no change to the task's state. This includes "
        "opening something and closing it without acting, navigating somewhere and returning, starting an "
        "entry and clearing it, or making a correction that supersedes an earlier action. Judge this from "
        "what happens on screen, not from assumed pages or routes. Exclude the whole segment from steps and "
        "add a pruned object with its source at_seconds timestamp and a plain-English reason.\n"
        "- Detect reusable input values. Names, emails, companies, IDs, dates, amounts, addresses, and other "
        "values that look like row-specific input data must become variables. Give each a snake_case name, "
        "a sensible source_column guess, and the observed literal as example. Reference it in step.value as "
        "{{variable_name}}; never inline the observed input-data literal. Variable references must have no "
        "inner whitespace: {{company}} is valid, while {{ company }} is invalid.\n"
        "- Preserve typed text verbatim. For text the operator types into a message, prompt, or entry, "
        "step.value must keep the exact observed wording, order, punctuation, capitalization, and spelling. "
        "Never paraphrase, shorten, improve, summarize, or spell-correct it. Replace only the literal spans "
        "that came from reusable input data with their exact unpadded variable references. For example, if an "
        "observed company name is part of the text, replace only that substring with {{company}} and retain "
        "every other character exactly as typed.\n"
        "- A sentence may build across multiple adjacent frames while it is being typed. Reconstruct the final "
        "stable text from the chronological sequence before the operator submits it; do not invent, rewrite, "
        "or omit words that are visible across those frames.\n"
        "- observed_rows is optional display data, never workflow instructions. If the Brief declares variables "
        "and the frames visibly show a list, table, queue, search results, or other set of records the operator "
        "was working from, read only the values that correspond to those variables and emit observed_rows. Each "
        "row key must be an exact source_column declared by this Brief's variables, and each value must be a "
        "string copied verbatim from the screen. Include only rows you actually saw; never infer missing entries, "
        "invent rows, or pad the list to a round number. Omit observed_rows entirely when there are no variables "
        "or no clearly observed matching rows. The operator confirms or edits this display data before any run.\n"
        "- Detect conditions. If a step happens only because of something visible on the current screen, give "
        "that step a condition with a plain-English if predicate and else of skip_step or end_workflow. Omit "
        "condition entirely from unconditional steps.\n"
        "- Write intent as concise, imperative plain English for a human reviewer, not UI jargon.\n"
        "- Use calibrated confidence from 0.0 to 1.0 for each step. Reduce confidence where target role/name, "
        "intent, or conditional logic is ambiguous.\n"
        "- Steps must have unique, sequential 1-based ids. value is null for invoke_node, focus_node, and "
        "wait_for. press_key and hotkey put their key string in value. wait_for uses a semantic target.\n\n"
        "Return an object that validates exactly against this frozen JSON Schema. Do not add any fields, "
        "including source timestamps on steps:\n"
        f"{_contract_json()}"
        f"{retry_instruction}"
    )


def _contract_json() -> str:
    """Load the frozen Brief schema verbatim for the vision instruction."""

    try:
        schema = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    except OSError as error:
        raise RuntimeError("The frozen Brief schema could not be read.") from error
    return json.dumps(schema, separators=(",", ":"))
