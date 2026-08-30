from __future__ import annotations

import os
import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

DEFAULT_SAMPLE_FPS = 1.5
SHOWINFO_TIMESTAMP = re.compile(r"n:\s*\d+.*?pts_time:(-?\d+(?:\.\d+)?)")


class FrameSamplingError(RuntimeError):
    """Raised when ffmpeg cannot produce a timestamped frame sequence."""


@dataclass(frozen=True)
class SampledFrame:
    """A sampled JPEG and its timestamp on the recording's source timeline."""

    path: Path
    timestamp_seconds: float


def configured_sample_fps() -> float:
    """Return FRAME_SAMPLE_FPS, rejecting an invalid configuration explicitly."""

    raw_value = os.environ.get("FRAME_SAMPLE_FPS", str(DEFAULT_SAMPLE_FPS))
    try:
        sample_fps = float(raw_value)
    except ValueError as error:
        raise FrameSamplingError(
            "FRAME_SAMPLE_FPS must be a positive number."
        ) from error

    if sample_fps <= 0:
        raise FrameSamplingError("FRAME_SAMPLE_FPS must be a positive number.")
    return sample_fps


def sample_frames(
    video_path: Path,
    *,
    sample_fps: float | None = None,
    output_directory: Path | None = None,
) -> list[SampledFrame]:
    """Sample a video into JPEG frames, retaining every source timestamp."""

    if not video_path.is_file():
        raise FrameSamplingError(f"Recording file does not exist: {video_path}")

    resolved_sample_fps = (
        sample_fps if sample_fps is not None else configured_sample_fps()
    )
    if resolved_sample_fps <= 0:
        raise FrameSamplingError("The frame sample rate must be greater than zero.")

    frame_directory = _create_frame_directory(output_directory)
    timestamps = _run_ffmpeg(video_path, frame_directory, resolved_sample_fps)
    frame_paths = sorted(frame_directory.glob("frame_*.jpg"))

    if not frame_paths:
        raise FrameSamplingError(
            "ffmpeg did not produce any frames from the recording."
        )
    if len(frame_paths) != len(timestamps):
        raise FrameSamplingError(
            "ffmpeg produced frames without a matching source timestamp; refusing to return unusable frames."
        )

    return [
        SampledFrame(path=frame_path, timestamp_seconds=timestamp)
        for frame_path, timestamp in zip(frame_paths, timestamps, strict=True)
    ]


def _create_frame_directory(output_directory: Path | None) -> Path:
    if output_directory is None:
        return Path(tempfile.mkdtemp(prefix="owari-frames-"))

    if output_directory.exists():
        raise FrameSamplingError(
            f"Frame output directory already exists: {output_directory}"
        )
    output_directory.mkdir(parents=True)
    return output_directory


def _run_ffmpeg(
    video_path: Path, frame_directory: Path, sample_fps: float
) -> list[float]:
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "info",
        "-i",
        str(video_path),
        "-an",
        "-vf",
        f"fps={sample_fps},showinfo",
        "-q:v",
        "2",
        str(frame_directory / "frame_%06d.jpg"),
    ]
    completed_process = subprocess.run(
        command, capture_output=True, check=False, text=True
    )
    if completed_process.returncode != 0:
        detail = (
            completed_process.stderr.strip()
            or "ffmpeg did not provide an error message."
        )
        raise FrameSamplingError(f"Could not sample recording frames: {detail}")

    timestamps = [
        float(match.group(1))
        for line in completed_process.stderr.splitlines()
        if (match := SHOWINFO_TIMESTAMP.search(line)) is not None
    ]
    if any(timestamp < 0 for timestamp in timestamps):
        raise FrameSamplingError("ffmpeg produced a negative source timestamp.")
    return timestamps
