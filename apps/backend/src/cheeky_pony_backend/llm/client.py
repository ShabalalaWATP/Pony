# SPDX-License-Identifier: AGPL-3.0-only
"""OpenAI-compatible LLM client."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping, Sequence
from typing import Protocol, cast

import httpx

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.llm.errors import LlmClientError
from cheeky_pony_backend.llm.types import ChatMessage, LlmCompletion


class LlmClient(Protocol):
    """Completion client boundary used by the insight service."""

    async def complete(
        self,
        *,
        model: str,
        messages: list[ChatMessage],
        max_tokens: int,
        temperature: float = 0.2,
    ) -> LlmCompletion:
        """Return one validated chat completion."""


class OpenAICompatibleClient:
    """Talk to OpenAI's chat-completions API or a compatible local server."""

    def __init__(
        self,
        settings: Settings,
        *,
        client: httpx.AsyncClient | None = None,
        retry_sleep_seconds: float = 0.1,
    ) -> None:
        self._settings = settings
        self._client = client
        self._retry_sleep_seconds = retry_sleep_seconds

    async def complete(
        self,
        *,
        model: str,
        messages: list[ChatMessage],
        max_tokens: int,
        temperature: float = 0.2,
    ) -> LlmCompletion:
        """Return a completion with bounded timeout and retry behavior."""

        payload = {
            "model": model,
            "messages": [message.model_dump(mode="json") for message in messages],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "response_format": {"type": "json_object"},
        }
        response = await self._post_with_retry(payload)
        return _parse_completion(response)

    async def _post_with_retry(self, payload: dict[str, object]) -> Mapping[str, object]:
        attempts = 3
        for attempt in range(attempts):
            try:
                response = await self._post(payload)
            except httpx.HTTPError as exc:
                raise LlmClientError() from exc
            if response.status_code >= 500 and attempt < attempts - 1:
                await asyncio.sleep(self._retry_sleep_seconds * (2**attempt))
                continue
            if response.status_code >= 400:
                raise LlmClientError()
            return _as_mapping(cast(object, response.json()))
        raise LlmClientError()

    async def _post(self, payload: dict[str, object]) -> httpx.Response:
        url = self._settings.llm_api_base_url.rstrip("/") + "/chat/completions"
        headers = {"Content-Type": "application/json"}
        if self._settings.llm_api_key is not None:
            headers["Authorization"] = "Bearer " + self._settings.llm_api_key.get_secret_value()
        timeout = httpx.Timeout(float(self._settings.llm_request_timeout_seconds))
        if self._client is not None:
            return await self._client.post(url, json=payload, headers=headers, timeout=timeout)
        async with httpx.AsyncClient(timeout=timeout) as client:
            return await client.post(url, json=payload, headers=headers)


def _parse_completion(payload: Mapping[str, object]) -> LlmCompletion:
    choices = _as_sequence(payload.get("choices"))
    if not choices:
        raise LlmClientError()
    first_choice = _as_mapping(choices[0])
    message = _as_mapping(first_choice.get("message"))
    content = message.get("content")
    if not isinstance(content, str) or not content:
        raise LlmClientError()
    usage = _optional_mapping(payload.get("usage"))
    return LlmCompletion(
        content=content,
        model=_string_value(payload.get("model"), "unknown"),
        tokens_input=_optional_int(usage.get("prompt_tokens") if usage else None),
        tokens_output=_optional_int(usage.get("completion_tokens") if usage else None),
    )


def _as_mapping(value: object) -> Mapping[str, object]:
    if isinstance(value, dict):
        return value
    raise LlmClientError()


def _optional_mapping(value: object) -> Mapping[str, object] | None:
    if value is None:
        return None
    return _as_mapping(value)


def _as_sequence(value: object) -> Sequence[object]:
    if isinstance(value, list):
        return value
    raise LlmClientError()


def _optional_int(value: object) -> int | None:
    if isinstance(value, int):
        return value
    return None


def _string_value(value: object, default: str) -> str:
    return value if isinstance(value, str) and value else default
