"""Native Xiaomi MiMo TTS adapter.

MiMo V2.5 exposes speech synthesis through ``/chat/completions`` rather than
OpenAI's ``/audio/speech`` endpoint. The text to speak is an ``assistant``
message and the returned audio is base64 in ``message.audio.data``.
"""

from __future__ import annotations

import base64
import binascii
from typing import Any

import httpx

from deeptutor.services.voice.adapters.openai_compat import (
    _join_api_path,
    _raise_for_provider,
)
from deeptutor.services.voice.base import (
    BaseTTSAdapter,
    VoiceProviderError,
    VoiceProviderHTTPError,
    build_auth_headers,
)
from deeptutor.services.voice.config import AUTH_API_KEY_HEADER, TTSConfig


_MIMO_FORMATS = {
    "wav": ("wav", "audio/wav"),
    "pcm": ("pcm16", "audio/pcm"),
    "pcm16": ("pcm16", "audio/pcm"),
}


def _redact(value: str, secret: str) -> str:
    return value.replace(secret, "[redacted]") if secret else value


class MiMoTTSAdapter(BaseTTSAdapter):
    """Synthesize speech using MiMo's native chat-completions contract."""

    async def synthesize(self, text: str, config: TTSConfig) -> tuple[bytes, str]:
        if not config.base_url:
            raise VoiceProviderError("No endpoint URL configured for MiMo TTS.")

        requested_format = (config.response_format or "wav").strip().lower()
        format_info = _MIMO_FORMATS.get(requested_format)
        if format_info is None:
            supported = ", ".join(sorted(_MIMO_FORMATS))
            raise VoiceProviderError(
                f"MiMo TTS supports only these output formats: {supported}."
            )
        audio_format, content_type = format_info
        url = _join_api_path(config.base_url, "chat/completions")
        headers = {
            "Content-Type": "application/json",
            **build_auth_headers(AUTH_API_KEY_HEADER, config.api_key),
            **(config.extra_headers or {}),
        }
        payload: dict[str, Any] = {
            "model": config.model,
            "messages": [{"role": "assistant", "content": text}],
            "audio": {
                "format": audio_format,
                "voice": config.voice or "mimo_default",
            },
        }

        try:
            async with httpx.AsyncClient(timeout=config.request_timeout) as client:
                response = await client.post(url, headers=headers, json=payload)
        except httpx.HTTPError as exc:
            raise VoiceProviderError(f"MiMo TTS request error: {exc}") from exc

        try:
            _raise_for_provider(response, "MiMo TTS synthesis")
        except VoiceProviderHTTPError as exc:
            raise VoiceProviderError(_redact(str(exc), config.api_key)) from exc

        try:
            body = response.json()
        except (ValueError, TypeError) as exc:
            raise VoiceProviderError("MiMo TTS returned a non-JSON response.") from exc

        audio_data = self._audio_data(body)
        try:
            audio = base64.b64decode(audio_data, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise VoiceProviderError("MiMo TTS returned invalid base64 audio.") from exc
        if not audio:
            raise VoiceProviderError("MiMo TTS returned empty audio.")
        return audio, content_type

    @staticmethod
    def _audio_data(body: Any) -> str:
        if not isinstance(body, dict):
            raise VoiceProviderError("MiMo TTS response was not a JSON object.")
        choices = body.get("choices")
        if not isinstance(choices, list) or not choices:
            raise VoiceProviderError("MiMo TTS response had no choices.")
        first = choices[0]
        message = first.get("message") if isinstance(first, dict) else None
        audio = message.get("audio") if isinstance(message, dict) else None
        data = audio.get("data") if isinstance(audio, dict) else None
        if not isinstance(data, str) or not data:
            raise VoiceProviderError("MiMo TTS response had no `message.audio.data` field.")
        return data


__all__ = ["MiMoTTSAdapter"]
