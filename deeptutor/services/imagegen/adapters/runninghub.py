"""RunningHub low-price Image2 adapter.

RunningHub Image G 2.0 is an asynchronous image-to-image API. The adapter
submits the low-price task, polls its query endpoint, downloads the resulting
image, and returns raw bytes to DeepTutor's normal image artifact pipeline.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Any

import httpx

from deeptutor.services.generation_http import (
    GenerationProviderError,
    build_auth_headers,
    join_api_path,
    raise_for_provider,
)
from deeptutor.services.imagegen.base import BaseImagegenAdapter
from deeptutor.services.imagegen.config import ImagegenConfig

logger = logging.getLogger(__name__)

_SUBMIT_PATH = "openapi/v2/rhart-image-g-2/image-to-image"
_QUERY_PATH = "openapi/v2/query"
_SUCCESS_WORDS = {"success", "succeeded", "completed", "complete", "finished", "finish", "done"}
_FAILURE_STATES = {"failed", "failure", "fail", "error", "rejected", "cancelled", "canceled"}
_IMAGE_URL_RE = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)


class RunningHubImage2Adapter(BaseImagegenAdapter):
    """Call RunningHub's low-price Image2 endpoint and materialize its result."""

    @staticmethod
    def _headers(config: ImagegenConfig) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "deeptutor-runninghub-image2/1.0",
            **build_auth_headers(config.auth_style, config.api_key),
            **(config.extra_headers or {}),
        }

    @staticmethod
    def _image_urls(config: ImagegenConfig) -> list[str]:
        urls = [str(url).strip() for url in config.reference_image_urls if str(url).strip()]
        invalid = [url for url in urls if not url.startswith(("http://", "https://"))]
        if invalid:
            raise GenerationProviderError(
                "RunningHub Image2 reference images must be public http/https URLs."
            )
        if not urls:
            raise GenerationProviderError(
                "RunningHub Image2 requires at least one public reference image URL. "
                "Add one in Settings > Image Generation."
            )
        return list(dict.fromkeys(urls))

    @staticmethod
    def _payload(prompt: str, config: ImagegenConfig) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "prompt": prompt,
            "imageUrls": RunningHubImage2Adapter._image_urls(config),
            "aspectRatio": config.aspect_ratio or "1:1",
            "resolution": config.resolution or "4k",
            "tools": config.tools or ["image_generation"],
        }
        if "image_generation" not in payload["tools"]:
            payload["tools"] = [*payload["tools"], "image_generation"]
        return payload

    async def generate(
        self, prompt: str, config: ImagegenConfig, *, n: int = 1
    ) -> list[tuple[bytes, str]]:
        if not config.base_url:
            raise GenerationProviderError("No endpoint URL configured for image generation.")
        if not config.api_key:
            raise GenerationProviderError("RunningHub Image2 requires an API key.")
        # RunningHub's low-price Image2 endpoint returns one task per submit;
        # keep the existing n contract by submitting one task per requested image.
        payload = self._payload(prompt, config)
        submit_url = join_api_path(config.base_url, _SUBMIT_PATH)
        query_url = join_api_path(config.base_url, _QUERY_PATH)
        headers = self._headers(config)
        images: list[tuple[bytes, str]] = []
        try:
            async with httpx.AsyncClient(timeout=config.request_timeout) as client:
                for index in range(max(1, n)):
                    logger.debug("runninghub image2 submit url=%s index=%d", submit_url, index + 1)
                    response = await client.post(submit_url, headers=headers, json=payload)
                    raise_for_provider(response, "RunningHub Image2 submission")
                    task_id = self._extract_task_id(response)
                    logger.info("RunningHub Image2 task accepted task_id=%s", task_id)
                    result = await self._poll(client, query_url, headers, config, task_id)
                    result_url = self._extract_image_url(result)
                    download = await client.get(result_url, headers={"User-Agent": headers["User-Agent"]})
                    raise_for_provider(download, "RunningHub Image2 download")
                    content_type = download.headers.get("content-type") or "image/png"
                    if not content_type.startswith("image/"):
                        content_type = "image/png"
                    if not download.content:
                        raise GenerationProviderError("RunningHub Image2 returned an empty image.")
                    images.append((download.content, content_type))
        except httpx.HTTPError as exc:
            raise GenerationProviderError(f"RunningHub Image2 request error: {exc}") from exc
        return images

    @staticmethod
    def _extract_task_id(response: httpx.Response) -> str:
        data = response.json()
        candidates = [data]
        if isinstance(data, dict) and isinstance(data.get("data"), dict):
            candidates.append(data["data"])
        for item in candidates:
            if not isinstance(item, dict):
                continue
            for key in ("taskId", "task_id", "id"):
                value = item.get(key)
                if isinstance(value, (str, int)) and str(value).strip():
                    return str(value)
        raise GenerationProviderError("RunningHub Image2 submission returned no task id.")

    async def _poll(
        self,
        client: httpx.AsyncClient,
        query_url: str,
        headers: dict[str, str],
        config: ImagegenConfig,
        task_id: str,
    ) -> dict[str, Any]:
        deadline = time.monotonic() + max(1, config.poll_timeout)
        last: dict[str, Any] = {}
        while True:
            response = await client.post(query_url, headers=headers, json={"taskId": task_id})
            raise_for_provider(response, "RunningHub Image2 task status")
            data = response.json()
            if not isinstance(data, dict):
                raise GenerationProviderError("RunningHub Image2 returned malformed task status.")
            last = data
            if self._extract_image_url(data):
                return data
            status = self._status(data)
            if status in _FAILURE_STATES or self._has_error(data):
                detail = self._error_detail(data) or "no detail provided"
                raise GenerationProviderError(f"RunningHub Image2 task {task_id} failed: {detail}")
            if time.monotonic() >= deadline:
                raise GenerationProviderError(
                    f"RunningHub Image2 task {task_id} timed out after {config.poll_timeout}s "
                    f"(last status: {status or 'unknown'})."
                )
            await asyncio.sleep(max(0.0, config.poll_interval))

    @staticmethod
    def _status(data: dict[str, Any]) -> str:
        for key in ("status", "state", "taskStatus"):
            value = data.get(key)
            if value is not None:
                return str(value).strip().lower()
        return ""

    @classmethod
    def _extract_image_url(cls, value: Any) -> str:
        if isinstance(value, str):
            match = _IMAGE_URL_RE.search(value)
            if match:
                candidate = match.group(0).rstrip(",.;)")
                if any(ext in candidate.lower() for ext in (".png", ".jpg", ".jpeg", ".webp")):
                    return candidate
        elif isinstance(value, dict):
            for item in value.values():
                result = cls._extract_image_url(item)
                if result:
                    return result
        elif isinstance(value, list):
            for item in value:
                result = cls._extract_image_url(item)
                if result:
                    return result
        return ""

    @classmethod
    def _has_error(cls, data: dict[str, Any]) -> bool:
        for key in ("errorCode", "error_code", "errorMessage", "error_msg", "failedReason"):
            value = data.get(key)
            if value not in (None, "", {}, []):
                return True
        return False

    @staticmethod
    def _error_detail(data: dict[str, Any]) -> str:
        for key in ("errorMessage", "error_msg", "failedReason", "message", "error"):
            value = data.get(key)
            if isinstance(value, dict):
                value = value.get("message") or value.get("detail")
            if value not in (None, "", {}, []):
                return str(value)[:400]
        return ""


__all__ = ["RunningHubImage2Adapter"]
