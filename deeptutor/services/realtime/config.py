"""Server-only configuration for the NianNian realtime tutor.

Only environment variables are read here.  The browser, Android wrapper and
model catalog deliberately never receive the provider credential.
"""

from __future__ import annotations

from dataclasses import dataclass
import os
from urllib.parse import urlencode, urlparse, urlunparse, parse_qsl


DEFAULT_MODEL = "qwen3.5-omni-flash-realtime"
DEFAULT_TEST_USERS = frozenset({"admin123", "admin666"})
DAILY_LIMIT_SECONDS = 15 * 60
SESSION_LIMIT_SECONDS = 10 * 60


@dataclass(frozen=True)
class RealtimeTutorConfig:
    """Runtime-only connection data; never serialize this object to clients."""

    api_key: str
    websocket_url: str
    workspace_id: str = ""
    model: str = DEFAULT_MODEL
    allowed_users: frozenset[str] = DEFAULT_TEST_USERS
    daily_limit_seconds: int = DAILY_LIMIT_SECONDS
    session_limit_seconds: int = SESSION_LIMIT_SECONDS

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.websocket_url)

    def allows(self, username: str, *, is_admin: bool = False) -> bool:
        return is_admin or username in self.allowed_users


def _positive_int(value: str | None, default: int) -> int:
    try:
        return max(1, int(value or default))
    except (TypeError, ValueError):
        return default


def _with_model(url: str, model: str) -> str:
    """Append the fixed model query parameter without touching credentials."""
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.setdefault("model", model)
    return urlunparse(parsed._replace(query=urlencode(query)))


def _default_websocket_url(workspace_id: str, model: str) -> str:
    # Beijing workspace endpoint documented by Model Studio for realtime WSS.
    base = f"wss://{workspace_id}.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime"
    return _with_model(base, model)


def load_realtime_tutor_config() -> RealtimeTutorConfig:
    """Load the pilot's provider config without logging or persisting secrets."""
    model = (os.getenv("DASHSCOPE_REALTIME_MODEL") or DEFAULT_MODEL).strip()
    workspace_id = (os.getenv("DASHSCOPE_WORKSPACE_ID") or "").strip()
    configured_url = (os.getenv("DASHSCOPE_REALTIME_URL") or "").strip()
    websocket_url = configured_url or (_default_websocket_url(workspace_id, model) if workspace_id else "")
    raw_users = (os.getenv("NIANNIAN_REALTIME_TEST_USERS") or "").strip()
    allowed_users = frozenset(
        item.strip() for item in raw_users.split(",") if item.strip()
    ) or DEFAULT_TEST_USERS
    session_limit = _positive_int(
        os.getenv("NIANNIAN_REALTIME_SESSION_LIMIT_SECONDS"), SESSION_LIMIT_SECONDS
    )
    daily_limit = _positive_int(
        os.getenv("NIANNIAN_REALTIME_DAILY_LIMIT_SECONDS"), DAILY_LIMIT_SECONDS
    )
    return RealtimeTutorConfig(
        api_key=(os.getenv("DASHSCOPE_API_KEY") or "").strip(),
        websocket_url=_with_model(websocket_url, model) if websocket_url else "",
        workspace_id=workspace_id,
        model=model,
        allowed_users=allowed_users,
        daily_limit_seconds=daily_limit,
        session_limit_seconds=min(session_limit, daily_limit),
    )
