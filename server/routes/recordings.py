"""Recording upload, listing, and playback. Contracts in API.md."""

from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from server import db
from server.brief_schema import BriefValidationError, validate_brief
from server.config import PROJECT_ROOT, RECORDINGS_DIR, config
from server.errors import ApiError
from server.events import broadcaster

logger = logging.getLogger("crewmate.server.recordings")

router = APIRouter()

CHUNK_BYTES = 1024 * 1024
TASK_NAME_MAX = 200
# Every MP4 carries a 'ftyp' box marker at offset 4. Checked against the bytes actually
# received rather than the filename or the client's Content-Type, either of which can lie.
MP4_MAGIC_OFFSET = 4
MP4_MAGIC = b"ftyp"


def _resolve_video_path(video_path: str) -> Path:
    """Resolve a stored relative path and confirm it stays inside the recordings directory."""
    resolved = (PROJECT_ROOT / video_path).resolve()
    if not resolved.is_relative_to(RECORDINGS_DIR.resolve()):
        raise ApiError(404, "recording_not_found", "The recording file is missing.")
    return resolved


async def _write_upload(video: UploadFile, destination: Path) -> tuple[int, bytes]:
    """Stream the upload to disk. Returns the byte count and the file's opening bytes."""
    total = 0
    head = b""
    with destination.open("wb") as handle:
        while chunk := await video.read(CHUNK_BYTES):
            if len(head) < MP4_MAGIC_OFFSET + len(MP4_MAGIC):
                head += chunk[: MP4_MAGIC_OFFSET + len(MP4_MAGIC)]
            handle.write(chunk)
            total += len(chunk)
    return total, head


@router.post("/recordings", status_code=201)
async def create_recording(
    video: Annotated[UploadFile, File()],
    task_name: Annotated[str, Form()],
    duration_seconds: Annotated[float, Form(ge=0)],
) -> JSONResponse:
    """Accept an uploaded screen recording from the overlay.

    The file is written first and the row second, so a failed write can never leave a
    recordings row pointing at a file that does not exist.
    """
    name = task_name.strip()
    if not name:
        raise ApiError(400, "invalid_task_name", "task_name must not be empty.")
    if len(name) > TASK_NAME_MAX:
        raise ApiError(
            400,
            "invalid_task_name",
            f"task_name must be at most {TASK_NAME_MAX} characters.",
        )

    RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
    destination = RECORDINGS_DIR / f"{db.new_id()}.mp4"

    try:
        size, head = await _write_upload(video, destination)
    except OSError as exc:
        destination.unlink(missing_ok=True)
        logger.exception("Failed writing upload to %s", destination)
        raise ApiError(
            500, "storage_write_failed", "Could not save the recording."
        ) from exc

    if size == 0:
        destination.unlink(missing_ok=True)
        raise ApiError(400, "empty_video", "video was zero bytes.")
    if head[MP4_MAGIC_OFFSET : MP4_MAGIC_OFFSET + len(MP4_MAGIC)] != MP4_MAGIC:
        destination.unlink(missing_ok=True)
        raise ApiError(400, "invalid_video", "video must be an MP4 file.")

    relative_path = destination.relative_to(PROJECT_ROOT).as_posix()
    try:
        recording = db.create_recording(name, relative_path, duration_seconds)
    except Exception as exc:
        destination.unlink(missing_ok=True)
        logger.exception("Failed inserting recording row for %s", relative_path)
        raise ApiError(
            500, "storage_write_failed", "Could not save the recording."
        ) from exc

    return JSONResponse(
        status_code=201,
        content={
            "id": recording.id,
            "task_name": recording.task_name,
            "duration_seconds": recording.duration_seconds,
            "status": recording.status,
            "created_at": recording.created_at,
        },
    )


@router.get("/recordings")
async def list_recordings() -> dict[str, list[dict[str, object]]]:
    """List recordings for the dashboard's home view, newest first."""
    return {
        "recordings": [
            {
                "id": item.id,
                "task_name": item.task_name,
                "duration_seconds": item.duration_seconds,
                "status": item.status,
                "brief_id": item.brief_id,
                "created_at": item.created_at,
            }
            for item in db.list_recordings()
        ]
    }


@router.get("/recordings/{recording_id}/video")
async def get_recording_video(recording_id: str) -> FileResponse:
    """Serve the MP4 for the speedrun view. Range requests are handled by FileResponse."""
    recording = db.get_recording(recording_id)
    if recording is None:
        raise ApiError(404, "recording_not_found", "No recording with that id.")
    path = _resolve_video_path(recording.video_path)
    if not path.is_file():
        raise ApiError(404, "recording_not_found", "The recording file is missing.")
    return FileResponse(
        path,
        media_type="video/mp4",
        headers={"Accept-Ranges": "bytes"},
    )


def _comprehend(recording: db.Recording) -> None:
    """Run comprehension on a background thread, reporting progress over SSE.

    The server owns HTTP, persistence and validation; `comprehension/` owns frames and the
    model. Importing it here is the documented seam — it is never imported anywhere else,
    and it is imported inside the function so a missing OPENAI_API_KEY cannot stop the
    server from starting.
    """
    channel = recording.id
    try:
        from comprehension.comprehend import comprehend_recording

        def publish_progress(stage: str, detail: str) -> None:
            broadcaster.publish(channel, "progress", {"stage": stage, "detail": detail})

        content = comprehend_recording(
            PROJECT_ROOT / recording.video_path,
            recording.task_name,
            publish_progress=publish_progress,
        )
        # Every write path validates. comprehension validates too, but this module is the
        # single implementation of record and the one that decides what may be persisted.
        brief = db.create_brief(recording.id, validate_brief(content))
        db.set_recording_status(recording.id, "comprehended")
        broadcaster.publish(channel, "complete", {"brief_id": brief.id})
        logger.info("Comprehended recording %s into brief %s", recording.id, brief.id)
    except BriefValidationError as exc:
        _fail_comprehension(channel, recording.id, "invalid_brief", str(exc))
    except Exception as exc:
        logger.exception("Comprehension failed for %s", recording.id)
        _fail_comprehension(channel, recording.id, "comprehension_failed", str(exc))
    finally:
        broadcaster.close(channel)


def _fail_comprehension(
    channel: str, recording_id: str, code: str, message: str
) -> None:
    db.set_recording_status(recording_id, "failed", message)
    broadcaster.publish(channel, "error", {"code": code, "message": message})


@router.post("/recordings/{recording_id}/comprehend", status_code=202)
async def comprehend(recording_id: str) -> JSONResponse:
    """Start comprehension. Returns immediately; progress arrives on the events stream."""
    recording = db.get_recording(recording_id)
    if recording is None:
        raise ApiError(404, "recording_not_found", "No recording with that id.")
    if recording.status in ("comprehending", "comprehended"):
        raise ApiError(
            409,
            "already_comprehending",
            f"This recording is already {recording.status}.",
        )
    if not config.vision_model:
        raise ApiError(
            500, "vision_model_not_configured", "VISION_MODEL is not set in .env."
        )

    db.set_recording_status(recording_id, "comprehending")
    started = db.get_recording(recording_id)
    if started is None:
        raise ApiError(404, "recording_not_found", "No recording with that id.")

    threading.Thread(
        target=_comprehend,
        args=(started,),
        name=f"crewmate-comprehend-{recording_id[:8]}",
        daemon=True,
    ).start()

    return JSONResponse(
        status_code=202,
        content={"recording_id": recording_id, "status": "comprehending"},
    )
