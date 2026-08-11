"""Authenticated server-side proxy for NianNian's realtime voice teacher."""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import secrets
import time
from typing import Any

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
import websockets

from deeptutor.api.routers.auth import TokenPayload, _current_access_metadata, require_active_access
from deeptutor.multi_user.context import get_current_user, reset_current_user
from deeptutor.services import billing
from deeptutor.services.realtime.config import load_realtime_tutor_config
from deeptutor.services.realtime.dashscope import (
    encode_realtime_image,
    initial_response,
    provider_events_for_client_event,
    public_provider_event,
    session_update,
    teacher_instructions,
    usage_from_event,
    valid_client_event,
)
from deeptutor.services.realtime.usage import RealtimeUsageStore
from deeptutor.services.session import get_session_store

router = APIRouter()
logger = logging.getLogger(__name__)

# A browser WebSocket cannot attach the HttpOnly login cookie reliably after a
# reverse-proxy upgrade. Hand off a single-use opaque capability over the normal
# authenticated HTTP path, then consume it at the WebSocket boundary.
_REALTIME_HANDOFF_TTL_SECONDS = 60.0
_realtime_handoffs: dict[str, tuple[float, TokenPayload]] = {}


def _issue_realtime_handoff(payload: TokenPayload) -> str:
    now = time.monotonic()
    for key, (expires_at, _) in list(_realtime_handoffs.items()):
        if expires_at <= now:
            _realtime_handoffs.pop(key, None)
    token = secrets.token_urlsafe(32)
    _realtime_handoffs[token] = (now + _REALTIME_HANDOFF_TTL_SECONDS, payload)
    return token


def _consume_realtime_handoff(token: str) -> TokenPayload | None:
    record = _realtime_handoffs.pop(token, None)
    if record is None or record[0] <= time.monotonic():
        return None
    return record[1]


async def _send(websocket: WebSocket, payload: dict[str, Any]) -> bool:
    try:
        await websocket.send_json(payload)
        return True
    except (WebSocketDisconnect, RuntimeError, ConnectionError):
        return False


def _connect_kwargs(headers: dict[str, str]) -> dict[str, object]:
    """Keep the server proxy compatible with installed websockets 12+ releases."""
    name = (
        "additional_headers"
        if "additional_headers" in inspect.signature(websockets.connect).parameters
        else "extra_headers"
    )
    return {
        name: headers,
        "max_size": 2 * 1024 * 1024,
        "ping_interval": 20,
        "open_timeout": 12,
        "close_timeout": 3,
    }


async def _wait_for_provider_session_ready(provider: Any) -> bool:
    """Wait for Qwen to apply session.update before creating a response."""
    try:
        while True:
            raw = await asyncio.wait_for(provider.recv(), timeout=20)
            try:
                event = json.loads(raw)
            except (TypeError, json.JSONDecodeError):
                continue
            event_type = event.get("type") if isinstance(event, dict) else None
            if event_type == "session.updated":
                return True
            if event_type == "error":
                error = event.get("error") if isinstance(event, dict) else None
                logger.error(
                    "Realtime provider rejected session.update: %s",
                    error.get("code") if isinstance(error, dict) else "unknown",
                )
                return False
    except (asyncio.TimeoutError, websockets.exceptions.ConnectionClosed):
        logger.error("Realtime provider did not acknowledge session.update")
        return False


def _question_for_start(payload: object) -> tuple[dict[str, str] | None, str | None]:
    if not isinstance(payload, dict) or payload.get("type") != "session.start":
        return None, "请重新打开语音老师后再试。"
    variant = payload.get("variant", "conversation")
    if variant not in {"conversation", "diagnostic", "practice"}:
        return None, "当前语音会话不可用，请重新打开后再试。"
    context = payload.get("context", "")
    from deeptutor.services.learning_mode import normalize_learning_mode, teaching_policy

    mode = normalize_learning_mode(payload.get("learning_mode"))
    question_context = {
        "agent_scope": "通用 AI Agent",
        "knowledge_point": "当前对话",
        "prompt": "学生正在和念念进行实时语音交流。先听懂学生的问题、材料或任务，再给出准确、分步骤的帮助。",
        "conversation_context": context[:6000] if isinstance(context, str) else "",
    }
    if mode:
        question_context["teaching_policy"] = teaching_policy(mode)
    return question_context, None


def _learning_mode_from_session_messages(messages: list[dict[str, Any]]) -> str:
    """Recover the latest server-recorded learning mode for a voice follow-up."""
    from deeptutor.services.learning_mode import normalize_learning_mode

    for message in reversed(messages):
        if message.get("role") != "user":
            continue
        metadata = message.get("metadata")
        if not isinstance(metadata, dict):
            continue
        snapshot = metadata.get("request_snapshot") or metadata.get("requestSnapshot")
        if not isinstance(snapshot, dict):
            continue
        config = snapshot.get("config")
        mode = normalize_learning_mode(
            config.get("learning_mode") if isinstance(config, dict) else None
        )
        if mode:
            return mode
    return ""


def _session_id_for_start(payload: object) -> str:
    if not isinstance(payload, dict):
        return ""
    session_id = payload.get("session_id")
    return session_id.strip()[:128] if isinstance(session_id, str) else ""


async def _latest_realtime_image(store: Any, session_id: str) -> str:
    """Load the latest user-owned picture from this session for one voice turn."""
    if not session_id:
        return ""
    try:
        messages = await store.get_messages(session_id)
        from deeptutor.services.storage import get_attachment_store

        attachment_store = get_attachment_store()
        resolve = getattr(attachment_store, "resolve_path", None)
        if resolve is None:
            return ""
        for message in reversed(messages):
            if message.get("role") != "user":
                continue
            attachments = message.get("attachments")
            if not isinstance(attachments, list):
                continue
            for attachment in reversed(attachments):
                if not isinstance(attachment, dict):
                    continue
                mime_type = str(attachment.get("mime_type") or "").lower()
                if attachment.get("type") != "image" and not mime_type.startswith("image/"):
                    continue
                attachment_id = str(attachment.get("id") or "")
                filename = str(attachment.get("filename") or "")
                if not attachment_id or not filename:
                    continue
                path = resolve(
                    session_id=session_id,
                    attachment_id=attachment_id,
                    filename=filename,
                )
                if path is None or path.stat().st_size > 12 * 1024 * 1024:
                    continue
                image = encode_realtime_image(path.read_bytes())
                if image:
                    return image
    except Exception:
        logger.warning("Could not prepare realtime image context for session %s", session_id)
    return ""


def _transcript_for_event(event: object) -> str:
    if not isinstance(event, dict):
        return ""
    transcript = event.get("transcript")
    if isinstance(transcript, str):
        return transcript.strip()
    item = event.get("item")
    if isinstance(item, dict) and isinstance(item.get("transcript"), str):
        return item["transcript"].strip()
    return ""


async def _append_realtime_transcript(
    store: Any | None,
    session_id: str,
    role: str,
    transcript: str,
) -> None:
    if store is None or not session_id or not transcript:
        return
    try:
        await store.add_message(
            session_id=session_id,
            role=role,
            content=transcript[:4_000],
            capability="realtime_tutor",
            metadata={"source": "realtime_tutor"},
        )
    except Exception:
        logger.warning("Could not save realtime transcript for session %s", session_id)


@router.get("/tutor-token")
async def realtime_tutor_token(
    payload: TokenPayload | None = Depends(require_active_access),
) -> dict[str, str | None]:
    """Create a one-use bridge token for browsers behind a reverse proxy."""
    return {"token": _issue_realtime_handoff(payload) if payload is not None else None}


@router.websocket("/tutor")
async def realtime_tutor(websocket: WebSocket) -> None:
    """Proxy a fixed, student-safe realtime session without exposing credentials."""
    from deeptutor.api.routers.auth import ws_auth_failed, ws_require_auth

    handoff = websocket.query_params.get("handoff")
    if handoff:
        payload = _consume_realtime_handoff(handoff)
        if payload is None:
            await websocket.close(code=4001)
            return
        if str(_current_access_metadata(payload)["access_status"]) != "active":
            await websocket.close(code=4003)
            return
        from deeptutor.api.routers.auth import _install_current_user

        user_token = _install_current_user(payload)
    else:
        user_token = await ws_require_auth(websocket)
    if user_token is ws_auth_failed:
        return
    try:
        user = get_current_user()
        config = load_realtime_tutor_config()
        await websocket.accept()
        if not config.configured:
            await _send(
                websocket,
                {
                    "type": "unavailable",
                    "code": "realtime_not_configured",
                    "message": "念念实时语音老师正在准备中，请先使用录音作答。",
                },
            )
            await websocket.close(code=1000)
            return
        if not config.allows(
            user.username, is_admin=user.is_admin
        ) and not billing.has_active_membership(user.id):
            await _send(
                websocket,
                {
                    "type": "unavailable",
                    "code": "realtime_not_available_for_account",
                    "message": "实时语音老师正在内测中，请先使用录音作答。",
                },
            )
            await websocket.close(code=1000)
            return

        usage_store = RealtimeUsageStore()
        legacy_access = user.is_admin or user.username in config.allowed_users
        remaining = (
            usage_store.remaining_seconds(config.daily_limit_seconds) if legacy_access else 0
        )
        if legacy_access and remaining <= 0:
            await _send(
                websocket,
                {
                    "type": "unavailable",
                    "code": "daily_limit_reached",
                    "message": "今天的实时语音时间已用完，明天再继续吧。现在可以改用录音作答。",
                },
            )
            await websocket.close(code=1000)
            return

        try:
            start_payload = await asyncio.wait_for(websocket.receive_json(), timeout=20)
        except asyncio.TimeoutError:
            await _send(websocket, {"type": "error", "message": "连接超时，请重新打开念念老师。"})
            await websocket.close(code=1000)
            return
        except (WebSocketDisconnect, ValueError, TypeError):
            return
        question_context, start_error = _question_for_start(start_payload)
        if start_error or question_context is None:
            await _send(websocket, {"type": "error", "message": start_error or "当前题目不可用。"})
            await websocket.close(code=1000)
            return
        from deeptutor.services.learner_profile import context_summary

        learner_context = context_summary()
        if learner_context:
            question_context["conversation_context"] = (
                str(question_context.get("conversation_context") or "") + "\n" + learner_context
            )[:6000]

        conversation_session_id = _session_id_for_start(start_payload)
        conversation_store: Any | None = None
        realtime_image = ""
        if conversation_session_id:
            try:
                candidate_store = get_session_store()
                if await candidate_store.get_session(conversation_session_id) is not None:
                    conversation_store = candidate_store
                    if not question_context.get("teaching_policy"):
                        from deeptutor.services.learning_mode import teaching_policy

                        mode = _learning_mode_from_session_messages(
                            await candidate_store.get_messages(conversation_session_id)
                        )
                        if mode:
                            question_context["teaching_policy"] = teaching_policy(mode)
                    realtime_image = await _latest_realtime_image(
                        candidate_store, conversation_session_id
                    )
                else:
                    conversation_session_id = ""
            except Exception:
                logger.warning("Could not prepare realtime transcript storage")
                conversation_session_id = ""

        allowed_seconds = 0
        voice_session_id = f"voice_{secrets.token_urlsafe(18)}"
        voice_quota_reserved = False
        session_status = "released"
        started_at = time.monotonic()
        input_tokens = 0
        output_tokens = 0
        instructions = teacher_instructions(
            **question_context, has_realtime_image=bool(realtime_image)
        )
        headers = {"Authorization": f"Bearer {config.api_key}"}
        if config.workspace_id:
            headers["X-DashScope-WorkSpace"] = config.workspace_id
        connect_kwargs = _connect_kwargs(headers)

        try:
            if legacy_access:
                allowed_seconds = min(remaining, config.session_limit_seconds)
            else:
                try:
                    reservation = billing.reserve_voice_session(
                        user.id,
                        voice_session_id,
                        config.session_limit_seconds,
                    )
                except billing.BillingError as exc:
                    await _send(
                        websocket,
                        {
                            "type": "unavailable",
                            "code": "voice_quota_exhausted",
                            "message": str(exc),
                        },
                    )
                    return
                allowed_seconds = reservation["reserved_seconds"]
                remaining = reservation["remaining_seconds"]
                voice_quota_reserved = True
            async with websockets.connect(config.websocket_url, **connect_kwargs) as provider:
                logger.info("Realtime provider socket opened for account %s", user.id)
                await provider.send(
                    json.dumps(
                        session_update(config, instructions=instructions), ensure_ascii=False
                    )
                )
                if not await _wait_for_provider_session_ready(provider):
                    logger.error(
                        "Realtime provider session.update timed out for account %s", user.id
                    )
                    await _send(
                        websocket,
                        {"type": "error", "message": "念念老师暂时无法连接，请改用录音作答。"},
                    )
                    return
                logger.info("Realtime provider session updated for account %s", user.id)
                # Request the opening turn only after Qwen confirms the session.
                await provider.send(json.dumps(initial_response(), ensure_ascii=False))
                if not await _send(
                    websocket,
                    {
                        "type": "opening",
                        "has_realtime_image": bool(realtime_image),
                    },
                ):
                    return
                if not await _send(
                    websocket,
                    {
                        "type": "ready",
                        "remaining_seconds": remaining,
                        "session_limit_seconds": allowed_seconds,
                    },
                ):
                    return
                session_status = "completed"

                async def client_to_provider() -> None:
                    image_sent = False
                    deadline = started_at + allowed_seconds
                    while True:
                        timeout = deadline - time.monotonic()
                        if timeout <= 0:
                            await _send(
                                websocket,
                                {
                                    "type": "limit_reached",
                                    "message": "这次语音先到这里，整理一下后再继续学习吧。",
                                },
                            )
                            return
                        try:
                            raw = await asyncio.wait_for(websocket.receive_text(), timeout=timeout)
                        except asyncio.TimeoutError:
                            await _send(
                                websocket,
                                {
                                    "type": "limit_reached",
                                    "message": "这次语音先到这里，整理一下后再继续学习吧。",
                                },
                            )
                            return
                        except WebSocketDisconnect:
                            return
                        try:
                            event = json.loads(raw)
                        except json.JSONDecodeError:
                            await _send(
                                websocket,
                                {"type": "error", "message": "语音数据无效，请重新打开念念老师。"},
                            )
                            continue
                        if not valid_client_event(event):
                            await _send(
                                websocket, {"type": "error", "message": "这个语音操作暂不支持。"}
                            )
                            continue
                        image_for_event = "" if image_sent else realtime_image
                        for provider_event in provider_events_for_client_event(
                            event, image=image_for_event
                        ):
                            await provider.send(json.dumps(provider_event, ensure_ascii=False))
                        if image_for_event and event.get("type") == "input_audio_buffer.append":
                            image_sent = True
                        if event.get("type") == "session.end":
                            return

                async def provider_to_client() -> None:
                    nonlocal input_tokens, output_tokens
                    student_turn_seen = False
                    async for raw in provider:
                        try:
                            event = json.loads(raw)
                        except (TypeError, json.JSONDecodeError):
                            continue
                        added_input, added_output = usage_from_event(event)
                        input_tokens += added_input
                        output_tokens += added_output
                        event_type = event.get("type") if isinstance(event, dict) else ""
                        transcript = _transcript_for_event(event)
                        if event_type == "conversation.item.input_audio_transcription.completed":
                            # Voice turns stay inside the realtime call. The
                            # student explicitly submits text in the composer;
                            # auto-persisting speech would duplicate it in the
                            # visible conversation history.
                            student_turn_seen = bool(transcript)
                        elif event_type == "response.audio_transcript.done" and student_turn_seen:
                            student_turn_seen = False
                        visible = public_provider_event(event)
                        if visible is None:
                            continue
                        if visible.get("type") == "error":
                            await _send(
                                websocket,
                                {
                                    "type": "error",
                                    "message": "念念老师暂时没听清，请再说一次或改用录音作答。",
                                },
                            )
                            continue
                        if not await _send(websocket, visible):
                            return

                client_task = asyncio.create_task(client_to_provider())
                provider_task = asyncio.create_task(provider_to_client())
                done, pending = await asyncio.wait(
                    {client_task, provider_task}, return_when=asyncio.FIRST_COMPLETED
                )
                for task in pending:
                    task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
                for task in done:
                    error = task.exception()
                    if error is not None and not isinstance(error, WebSocketDisconnect):
                        raise error
        except WebSocketDisconnect:
            pass
        except Exception:
            logger.exception("Realtime tutor connection failed for account %s", user.id)
            await _send(
                websocket,
                {"type": "error", "message": "念念老师暂时无法连接，请改用录音作答。"},
            )
        finally:
            elapsed = min(allowed_seconds, max(0.0, time.monotonic() - started_at))
            if voice_quota_reserved:
                billing.settle_voice_session(
                    user.id,
                    voice_session_id,
                    elapsed_seconds=elapsed,
                    status=session_status,
                )
            elif allowed_seconds > 0:
                usage_store.record_session(
                    elapsed_seconds=elapsed,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                )
            try:
                await websocket.close(code=1000)
            except (RuntimeError, WebSocketDisconnect):
                pass
    finally:
        reset_current_user(user_token)
