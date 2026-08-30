from __future__ import annotations

import base64
import json
import os
import re
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import cast

from jsonschema import Draft7Validator
from openai import OpenAI

from comprehension.frames import SampledFrame, sample_frames
from comprehension.prompt import CONTRACT_PATH, build_vision_prompt

ProgressCallback = Callable[[str, str], None]
VisionCall = Callable[[str, Sequence[SampledFrame]], str]
PADDED_VARIABLE_REFERENCE = re.compile(r"\{\{[^{}]*\s[^{}]*\}\}")


class ComprehensionError(RuntimeError):
    """Raised when Owari cannot return one complete, schema-valid Brief."""


def comprehend_recording(
    video_path: Path,
    task_name: str,
    *,
    publish_progress: ProgressCallback | None = None,
    vision_call: VisionCall | None = None,
) -> dict[str, object]:
    """Sample a recording and return a complete validated Brief for the server to persist."""

    _publish(publish_progress, "sampling", "Sampling timestamped recording frames.")
    frames = sample_frames(video_path)
    return comprehend_frames(
        frames,
        task_name,
        publish_progress=publish_progress,
        vision_call=vision_call,
    )


def comprehend_frames(
    frames: Sequence[SampledFrame],
    task_name: str,
    *,
    publish_progress: ProgressCallback | None = None,
    vision_call: VisionCall | None = None,
) -> dict[str, object]:
    """Turn already-sampled frames into a complete validated Brief."""

    if not frames:
        raise ComprehensionError(
            "Cannot comprehend a recording with no sampled frames."
        )
    if not task_name.strip():
        raise ComprehensionError("A task name is required for comprehension.")

    model_call = vision_call if vision_call is not None else _call_vision_model
    validation_error: str | None = None

    for attempt in range(2):
        _publish(
            publish_progress,
            "analysing",
            "Analysing the recording for the intended workflow.",
        )
        prompt = build_vision_prompt(
            task_name, frames, validation_error=validation_error
        )
        model_output = model_call(prompt, frames)

        _publish(
            publish_progress,
            "validating",
            "Validating the complete Brief against the frozen contract.",
        )
        brief, validation_error = _parse_and_validate(model_output)
        if brief is not None:
            return brief
        if attempt == 0:
            continue

    raise ComprehensionError(
        "The vision model returned an invalid Brief after one retry: "
        f"{validation_error or 'no validation detail was available.'}"
    )


def _call_vision_model(prompt: str, frames: Sequence[SampledFrame]) -> str:
    model = os.environ.get("VISION_MODEL")
    if model is None or not model.strip():
        raise ComprehensionError(
            "VISION_MODEL must be set to a vision-capable model id."
        )

    content: list[dict[str, str]] = [{"type": "input_text", "text": prompt}]
    for frame in frames:
        try:
            encoded_frame = base64.b64encode(frame.path.read_bytes()).decode("ascii")
        except OSError as error:
            raise ComprehensionError(
                f"Could not read sampled frame {frame.path}."
            ) from error
        content.extend(
            [
                {
                    "type": "input_text",
                    "text": f"Frame source timestamp: {frame.timestamp_seconds:.3f} seconds",
                },
                {
                    "type": "input_image",
                    "image_url": f"data:image/jpeg;base64,{encoded_frame}",
                    "detail": "high",
                },
            ]
        )

    try:
        response = OpenAI().responses.create(
            model=model.strip(),
            input=[{"role": "user", "content": content}],
            store=False,
        )
    except Exception as error:
        raise ComprehensionError(
            "The vision model could not analyse the recording."
        ) from error

    if not response.output_text.strip():
        raise ComprehensionError("The vision model returned no Brief content.")
    return response.output_text


def _parse_and_validate(
    model_output: str,
) -> tuple[dict[str, object] | None, str | None]:
    try:
        parsed_output = cast(object, json.loads(model_output))
    except json.JSONDecodeError as error:
        return (
            None,
            f"Model output is not valid JSON at line {error.lineno}, column {error.colno}: {error.msg}",
        )

    if not isinstance(parsed_output, dict):
        return None, "Model output must be a JSON object containing a complete Brief."

    validation_errors = list(_brief_validator().iter_errors(parsed_output))
    if validation_errors:
        first_error = min(
            validation_errors, key=lambda error: list(error.absolute_path)
        )
        path = "$" + "".join(
            f"[{item}]" if isinstance(item, int) else f".{item}"
            for item in first_error.absolute_path
        )
        return None, f"{path}: {first_error.message}"

    padded_variable_error = _padded_variable_reference_error(parsed_output)
    if padded_variable_error is not None:
        return None, padded_variable_error

    return cast(dict[str, object], parsed_output), None


def _padded_variable_reference_error(brief: dict[object, object]) -> str | None:
    steps = brief.get("steps")
    if not isinstance(steps, list):
        return None

    for index, step in enumerate(steps):
        if not isinstance(step, dict):
            continue
        value = step.get("value")
        if isinstance(value, str) and PADDED_VARIABLE_REFERENCE.search(value):
            return (
                f"$.steps[{index}].value: variable references must not contain whitespace inside "
                "{{ and }}; use {{company}}, not {{ company }}."
            )
    return None


def _brief_validator() -> Draft7Validator:
    try:
        schema = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    except OSError as error:
        raise ComprehensionError(
            "The frozen Brief schema could not be read."
        ) from error
    return Draft7Validator(schema)


def _publish(callback: ProgressCallback | None, stage: str, detail: str) -> None:
    if callback is not None:
        callback(stage, detail)


def main() -> None:
    """Run comprehension from the command line for a local recording."""

    import argparse

    parser = argparse.ArgumentParser(
        description="Turn an Owari recording into a Brief."
    )
    parser.add_argument("video_path", type=Path)
    parser.add_argument("task_name")
    arguments = parser.parse_args()
    brief = comprehend_recording(arguments.video_path, arguments.task_name)
    print(json.dumps(brief, indent=2))


if __name__ == "__main__":
    main()
