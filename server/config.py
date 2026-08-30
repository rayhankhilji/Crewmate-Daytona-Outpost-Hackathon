"""Environment configuration, loaded once at import time from the project-root .env."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = PROJECT_ROOT / ".env"
STORAGE_ROOT = PROJECT_ROOT / "server" / "storage"
RECORDINGS_DIR = STORAGE_ROOT / "recordings"
DATABASE_PATH = PROJECT_ROOT / "server" / "crewmate.db"


class ConfigError(RuntimeError):
    """A required environment variable is missing or malformed."""


def _load_env_file(path: Path) -> None:
    """Read KEY=VALUE lines from .env into os.environ without overriding the real environment."""
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ConfigError(f"Malformed line in {path.name}: {raw_line!r}")
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


def _read_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    if not raw.isdigit() or int(raw) < 1:
        raise ConfigError(f"{name} must be a positive integer, got {raw!r}")
    return int(raw)


@dataclass(frozen=True)
class Config:
    """Resolved configuration.

    Secrets may be absent at startup: the server still boots so that /health can report a
    degraded state (see API.md). Every operation that actually needs one calls the matching
    require_* accessor, which raises with a human-readable message.
    """

    daytona_api_key: str
    snapshot_name: str
    vision_model: str
    max_parallel_workers: int

    def require_daytona_api_key(self) -> str:
        if not self.daytona_api_key:
            raise ConfigError("DAYTONA_API_KEY is not set in .env")
        return self.daytona_api_key

    def require_snapshot_name(self) -> str:
        if not self.snapshot_name:
            raise ConfigError("CREWMATE_SNAPSHOT_NAME is not set in .env")
        return self.snapshot_name

    def require_vision_model(self) -> str:
        if not self.vision_model:
            raise ConfigError("VISION_MODEL is not set in .env")
        return self.vision_model


def _build() -> Config:
    _load_env_file(ENV_PATH)
    return Config(
        daytona_api_key=os.environ.get("DAYTONA_API_KEY", "").strip(),
        snapshot_name=os.environ.get("CREWMATE_SNAPSHOT_NAME", "").strip(),
        vision_model=os.environ.get("VISION_MODEL", "").strip(),
        max_parallel_workers=_read_int("MAX_PARALLEL_WORKERS", 8),
    )


config = _build()
