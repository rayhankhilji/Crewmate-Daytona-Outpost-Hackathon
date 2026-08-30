"""Brief retrieval and editing. Contracts in API.md.

Both write paths go through `server.brief_schema.validate_brief` — the single validator.
An invalid Brief is rejected before any write, so a failed PATCH leaves the stored Brief
and its version untouched.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from server import db
from server.brief_schema import BriefValidationError, validate_brief
from server.errors import ApiError

router = APIRouter()


class BriefUpdate(BaseModel):
    """PATCH body. The client sends the complete Brief, not a partial patch."""

    content: dict[str, Any]


def _brief_response(brief: db.Brief) -> dict[str, Any]:
    return {
        "id": brief.id,
        "recording_id": brief.recording_id,
        "version": brief.version,
        "content": brief.content,
        "created_at": brief.created_at,
        "updated_at": brief.updated_at,
    }


def _require_brief(brief_id: str) -> db.Brief:
    brief = db.get_brief(brief_id)
    if brief is None:
        raise ApiError(404, "brief_not_found", "No brief with that id.")
    return brief


@router.get("/briefs/{brief_id}")
async def get_brief(brief_id: str) -> dict[str, Any]:
    """Fetch a Brief for review, editing, or launch."""
    return _brief_response(_require_brief(brief_id))


@router.patch("/briefs/{brief_id}")
async def update_brief(brief_id: str, update: BriefUpdate) -> dict[str, Any]:
    """Replace a Brief's content wholesale and increment its version.

    Validation runs first: an invalid Brief is never persisted and never advances version.
    """
    _require_brief(brief_id)
    try:
        content = validate_brief(update.content)
    except BriefValidationError as exc:
        raise ApiError(400, "invalid_brief", str(exc)) from exc
    return _brief_response(db.replace_brief_content(brief_id, content))
