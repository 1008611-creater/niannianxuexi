"""Account-scoped, audio-free usage accounting for realtime voice sessions."""

from __future__ import annotations

from datetime import datetime
import json
from pathlib import Path
import time

from pydantic import BaseModel, Field

from deeptutor.services.file_io import atomic_write_text
from deeptutor.services.path_service import get_path_service


def _day_key(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp).astimezone().date().isoformat()


class RealtimeUsage(BaseModel):
    date: str
    seconds_used: int = 0
    session_count: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    last_session_at: float | None = None


class RealtimeUsageStore:
    """Persist compact summaries in the current student's workspace only."""

    def __init__(self, root: Path | None = None) -> None:
        workspace = root or get_path_service().workspace_root
        self._path = workspace / "realtime" / "usage.json"
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def get_today(self, now: float | None = None) -> RealtimeUsage:
        timestamp = time.time() if now is None else now
        day = _day_key(timestamp)
        if not self._path.exists():
            return RealtimeUsage(date=day)
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            usage = RealtimeUsage.model_validate(raw)
            return usage if usage.date == day else RealtimeUsage(date=day)
        except (OSError, ValueError, TypeError):
            return RealtimeUsage(date=day)

    def remaining_seconds(self, daily_limit_seconds: int, now: float | None = None) -> int:
        return max(0, daily_limit_seconds - self.get_today(now).seconds_used)

    def record_session(
        self,
        *,
        elapsed_seconds: float,
        input_tokens: int = 0,
        output_tokens: int = 0,
        now: float | None = None,
    ) -> RealtimeUsage:
        timestamp = time.time() if now is None else now
        usage = self.get_today(timestamp)
        usage.seconds_used += max(0, int(round(elapsed_seconds)))
        usage.session_count += 1
        usage.input_tokens += max(0, int(input_tokens))
        usage.output_tokens += max(0, int(output_tokens))
        usage.last_session_at = timestamp
        atomic_write_text(self._path, usage.model_dump_json(indent=2))
        return usage
