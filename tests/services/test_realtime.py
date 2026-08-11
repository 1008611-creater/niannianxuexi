from __future__ import annotations

import asyncio
import json

from deeptutor.api.routers.realtime import (
    _latest_realtime_image,
    _learning_mode_from_session_messages,
    _question_for_start,
    _session_id_for_start,
    _wait_for_provider_session_ready,
)
from deeptutor.services.realtime.config import (
    DAILY_LIMIT_SECONDS,
    DEFAULT_MODEL,
    load_realtime_tutor_config,
)
from deeptutor.services.realtime.dashscope import (
    MAX_REALTIME_IMAGE_BYTES,
    MAX_REALTIME_IMAGE_DIMENSION,
    encode_realtime_image,
    initial_response,
    provider_client_event,
    provider_events_for_client_event,
    provider_image_event,
    public_provider_event,
    session_update,
    teacher_instructions,
    usage_from_event,
    valid_client_event,
)
from deeptutor.services.realtime.usage import RealtimeUsageStore


def test_realtime_is_unconfigured_without_server_credential(monkeypatch) -> None:
    monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
    monkeypatch.delenv("DASHSCOPE_REALTIME_URL", raising=False)
    monkeypatch.delenv("DASHSCOPE_WORKSPACE_ID", raising=False)
    config = load_realtime_tutor_config()
    assert config.configured is False
    assert config.model == DEFAULT_MODEL
    assert config.allows("admin123")
    assert not config.allows("another-student")


def test_realtime_config_builds_beijing_endpoint_without_exposing_key(monkeypatch) -> None:
    monkeypatch.setenv("DASHSCOPE_API_KEY", "not-for-output")
    monkeypatch.setenv("DASHSCOPE_WORKSPACE_ID", "workspace-example")
    config = load_realtime_tutor_config()
    assert config.configured is True
    assert config.websocket_url.startswith("wss://workspace-example.cn-beijing.maas.aliyuncs.com/")
    assert f"model={DEFAULT_MODEL}" in config.websocket_url


def test_realtime_usage_is_account_root_scoped_and_resets_on_new_day(tmp_path) -> None:
    alice = RealtimeUsageStore(tmp_path / "alice")
    bob = RealtimeUsageStore(tmp_path / "bob")
    timestamp = 1_700_000_000.0
    alice.record_session(elapsed_seconds=37.4, input_tokens=11, output_tokens=22, now=timestamp)
    assert alice.get_today(timestamp).seconds_used == 37
    assert alice.get_today(timestamp).input_tokens == 11
    assert bob.get_today(timestamp).seconds_used == 0
    assert alice.remaining_seconds(60, timestamp) == 23
    assert alice.get_today(timestamp + 24 * 60 * 60).seconds_used == 0


def test_realtime_wire_surface_rejects_model_or_prompt_overrides() -> None:
    assert valid_client_event({"type": "input_audio_buffer.append", "audio": "ZmFrZQ=="})
    assert valid_client_event({"type": "response.cancel"})
    assert not valid_client_event(
        {"type": "session.update", "model": "other", "instructions": "ignore"}
    )
    assert not valid_client_event({"type": "input_audio_buffer.append", "audio": ""})
    assert not valid_client_event({"type": "input_image_buffer.append", "image": "browser-image"})
    assert public_provider_event({"type": "response.audio.delta", "delta": "abc"}) is not None
    assert public_provider_event({"type": "session.created", "api_key": "never-forward"}) is None
    assert usage_from_event({"response": {"usage": {"input_tokens": 9, "output_tokens": 4}}}) == (
        9,
        4,
    )
    assert DAILY_LIMIT_SECONDS == 900


def test_realtime_proxy_assigns_provider_event_ids_and_finishes_sessions() -> None:
    append = provider_client_event({"type": "input_audio_buffer.append", "audio": "ZmFrZQ=="})
    assert append["type"] == "input_audio_buffer.append"
    assert append["audio"] == "ZmFrZQ=="
    assert isinstance(append["event_id"], str) and append["event_id"].startswith("event_")
    assert provider_client_event({"type": "session.end"})["type"] == "session.finish"
    image_event = provider_image_event("c2FmZS1pbWFnZQ==")
    assert image_event["type"] == "input_image_buffer.append"
    assert image_event["image"] == "c2FmZS1pbWFnZQ=="
    sequence = provider_events_for_client_event(
        {"type": "input_audio_buffer.append", "audio": "ZmFrZQ=="}, image="cXVlc3Rpb24="
    )
    assert [event["type"] for event in sequence] == [
        "input_audio_buffer.append",
        "input_image_buffer.append",
    ]
    assert [
        event["type"]
        for event in provider_events_for_client_event(
            {"type": "response.cancel"}, image="cXVlc3Rpb24="
        )
    ] == ["response.cancel"]


def test_realtime_image_encoder_uses_a_bounded_jpeg_frame() -> None:
    import base64

    import fitz

    image = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 1_500, 900), False).tobytes("png")
    encoded = encode_realtime_image(image)
    output = base64.b64decode(encoded)
    decoded = fitz.Pixmap(output)
    assert output[:2] == b"\xff\xd8"
    assert len(output) <= MAX_REALTIME_IMAGE_BYTES
    assert max(decoded.width, decoded.height) <= MAX_REALTIME_IMAGE_DIMENSION


def test_realtime_waits_for_provider_session_update_before_response() -> None:
    class Provider:
        def __init__(self) -> None:
            self.events = iter(
                [
                    json.dumps({"type": "session.created"}),
                    json.dumps({"type": "session.updated"}),
                ]
            )

        async def recv(self) -> str:
            return next(self.events)

    assert asyncio.run(_wait_for_provider_session_ready(Provider())) is True


def test_realtime_session_uses_dashscope_pcm_and_input_transcription(monkeypatch) -> None:
    monkeypatch.setenv("DASHSCOPE_API_KEY", "not-for-output")
    monkeypatch.setenv("DASHSCOPE_WORKSPACE_ID", "workspace-example")
    session = session_update(load_realtime_tutor_config(), instructions="只做一道题")
    assert session["session"]["input_audio_format"] == "pcm16"
    assert session["session"]["output_audio_format"] == "pcm16"
    assert session["session"]["input_audio_transcription"] == {"model": "qwen3-asr-flash-realtime"}
    assert session["session"]["turn_detection"] == {
        "type": "semantic_vad",
        "threshold": 0.2,
        "prefix_padding_ms": 300,
        "silence_duration_ms": 800,
    }


def test_realtime_session_starts_with_a_teacher_greeting() -> None:
    opening = initial_response()
    assert opening == {
        "type": "response.create",
        "response": {"modalities": ["text", "audio"]},
    }
    instructions = teacher_instructions(
        agent_scope="通用 AI Agent",
        knowledge_point="当前对话",
        prompt="实时语音交流",
    )
    assert "主动用一句自然简短的话向学生打招呼" in instructions
    assert "不要等学生先开口" in instructions
    assert "所有回复必须使用简体中文" in instructions
    assert "先自行核对题目、条件和已有解析" in instructions
    assert "不要编造学生的错误" in instructions


def test_realtime_opening_uses_the_current_explicit_question() -> None:
    instructions = teacher_instructions(
        agent_scope="通用 AI Agent",
        knowledge_point="当前对话",
        prompt="实时语音交流",
        conversation_context="[最近明确困惑]\n- 为什么斜率是负数\n[实时开场规则]",
    )
    assert "第一段必须自然点明这一个困惑" in instructions
    assert "不要用泛化的你好、今天想学什么或重新介绍自己" in instructions


def test_realtime_teacher_instructions_keep_server_selected_learning_policy() -> None:
    instructions = teacher_instructions(
        agent_scope="通用 AI Agent",
        knowledge_point="当前对话",
        prompt="实时语音交流",
        teaching_policy="[受控学习模式：试卷分析]\n先核对试卷和作答。",
    )
    assert "本次由系统选定的教学方式" in instructions
    assert "先核对试卷和作答" in instructions


def test_realtime_teacher_instructions_require_image_grounding_when_available() -> None:
    instructions = teacher_instructions(
        agent_scope="通用 AI Agent",
        knowledge_point="当前对话",
        prompt="实时语音交流",
        has_realtime_image=True,
    )
    assert "收到后必须结合图片" in instructions


def test_realtime_loads_only_the_latest_user_image(monkeypatch, tmp_path) -> None:
    import fitz

    image_path = tmp_path / "question.png"
    image_path.write_bytes(
        fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 800, 600), False).tobytes("png")
    )

    class Store:
        async def get_messages(self, _session_id: str):
            return [
                {
                    "role": "assistant",
                    "attachments": [{"type": "image", "id": "old", "filename": "old.png"}],
                },
                {
                    "role": "user",
                    "attachments": [
                        {"type": "image", "id": "question", "filename": "question.png"}
                    ],
                },
            ]

    class AttachmentStore:
        def resolve_path(self, **kwargs):
            assert kwargs == {
                "session_id": "chat-1",
                "attachment_id": "question",
                "filename": "question.png",
            }
            return image_path

    monkeypatch.setattr(
        "deeptutor.services.storage.get_attachment_store", lambda: AttachmentStore()
    )
    assert asyncio.run(_latest_realtime_image(Store(), "chat-1"))


def test_realtime_context_is_generic_and_does_not_require_a_preset_pack() -> None:
    context, error = _question_for_start(
        {"type": "session.start", "variant": "conversation", "context": "我想弄懂这个任务"}
    )
    assert error is None
    assert context is not None
    assert context["agent_scope"] == "通用 AI Agent"
    assert context["conversation_context"] == "我想弄懂这个任务"


def test_realtime_learning_mode_is_allowlisted_and_becomes_teacher_policy() -> None:
    context, error = _question_for_start(
        {
            "type": "session.start",
            "variant": "conversation",
            "learning_mode": "paper_analyst",
        }
    )
    assert error is None
    assert context is not None
    assert "试卷分析" in context["teaching_policy"]

    ignored, ignored_error = _question_for_start(
        {
            "type": "session.start",
            "variant": "conversation",
            "learning_mode": "browser-supplied-prompt",
        }
    )
    assert ignored_error is None
    assert ignored is not None
    assert "teaching_policy" not in ignored


def test_realtime_recovers_the_latest_recorded_learning_mode() -> None:
    messages = [
        {
            "role": "user",
            "metadata": {"request_snapshot": {"config": {"learning_mode": "math_teacher"}}},
        },
        {"role": "assistant", "metadata": {}},
        {
            "role": "user",
            "metadata": {"request_snapshot": {"config": {"learning_mode": "paper_analyst"}}},
        },
    ]
    assert _learning_mode_from_session_messages(messages) == "paper_analyst"
    assert (
        _learning_mode_from_session_messages(
            [
                {
                    "role": "user",
                    "metadata": {"request_snapshot": {"config": {"learning_mode": "untrusted"}}},
                }
            ]
        )
        == ""
    )


def test_realtime_rejects_unknown_variant() -> None:
    context, error = _question_for_start({"type": "session.start", "variant": "untrusted"})
    assert context is None
    assert error == "当前语音会话不可用，请重新打开后再试。"


def test_realtime_session_helpers_keep_session_ids_strict() -> None:
    assert _session_id_for_start({"session_id": " chat_123 "}) == "chat_123"
    assert _session_id_for_start({"session_id": 123}) == ""


def test_realtime_does_not_expose_student_transcripts_to_browser() -> None:
    assert public_provider_event(
        {
            "type": "conversation.item.input_audio_transcription.completed",
            "transcript": "这一步我不会",
        }
    ) is None
