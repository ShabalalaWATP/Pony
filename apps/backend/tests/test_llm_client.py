# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for the OpenAI-compatible LLM client."""

from __future__ import annotations

import json

import httpx
import pytest
from pydantic import SecretStr

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.llm.client import OpenAICompatibleClient
from cheeky_pony_backend.llm.errors import LlmClientError
from cheeky_pony_backend.llm.types import ChatMessage

pytestmark = pytest.mark.asyncio


async def test_client_posts_chat_completion_shape_and_retries_5xx() -> None:
    """The client sends OpenAI-compatible JSON and retries transient 5xx."""

    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        assert request.headers["authorization"] == "Bearer sk-test"
        body = json.loads(request.content)
        assert body["model"] == "gpt-4o-mini"
        assert body["messages"][0]["role"] == "user"
        if calls == 1:
            return httpx.Response(500, json={"error": "temporary"})
        return httpx.Response(
            200,
            json={
                "model": "gpt-4o-mini",
                "choices": [{"message": {"content": '{"summary":"ok"}'}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5},
            },
        )

    settings = _settings()
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        completion = await OpenAICompatibleClient(
            settings, client=http, retry_sleep_seconds=0
        ).complete(
            model=settings.llm_model,
            messages=[ChatMessage(role="user", content="hello")],
            max_tokens=50,
        )

    assert calls == 2
    assert completion.tokens_input == 10
    assert completion.tokens_output == 5


async def test_client_does_not_retry_4xx() -> None:
    """Programmer errors from the provider surface without retry loops."""

    calls = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(400, json={"error": "bad_request"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(LlmClientError):
            await OpenAICompatibleClient(_settings(), client=http).complete(
                model="gpt-4o-mini",
                messages=[ChatMessage(role="user", content="hello")],
                max_tokens=50,
            )

    assert calls == 1


async def test_client_exhausts_5xx_retries() -> None:
    """Repeated provider 5xx responses raise after the retry cap."""

    calls = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(503, json={"error": "unavailable"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(LlmClientError):
            await OpenAICompatibleClient(_settings(), client=http, retry_sleep_seconds=0).complete(
                model="gpt-4o-mini",
                messages=[ChatMessage(role="user", content="hello")],
                max_tokens=50,
            )

    assert calls == 3


async def test_client_timeout_becomes_client_error() -> None:
    """Transport failures are normalized to LLM client errors."""

    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connect_failed")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(LlmClientError):
            await OpenAICompatibleClient(_settings(), client=http).complete(
                model="gpt-4o-mini",
                messages=[ChatMessage(role="user", content="hello")],
                max_tokens=50,
            )


async def test_client_rejects_malformed_success_payload() -> None:
    """Malformed 200 responses fail closed as client errors."""

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": []})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(LlmClientError):
            await OpenAICompatibleClient(_settings(), client=http).complete(
                model="gpt-4o-mini",
                messages=[ChatMessage(role="user", content="hello")],
                max_tokens=50,
            )


async def test_client_allows_local_endpoint_without_authorization_header() -> None:
    """Local OpenAI-compatible endpoints can run without an API key."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert "authorization" not in request.headers
        return httpx.Response(
            200,
            json={
                "model": "local-model",
                "choices": [{"message": {"content": "{}"}}],
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        completion = await OpenAICompatibleClient(_local_settings(), client=http).complete(
            model="local-model",
            messages=[ChatMessage(role="user", content="hello")],
            max_tokens=50,
        )

    assert completion.model == "local-model"
    assert completion.tokens_input is None


def _settings() -> Settings:
    return Settings(
        env="test",
        cookie_secure=False,
        jwt_secret="j" * 32,
        bootstrap_token="bootstrap-token-test",
        use_in_memory_store=True,
        llm_enabled=True,
        llm_api_base_url="https://api.openai.com/v1",
        llm_api_key=SecretStr("sk-test"),
    )


def _local_settings() -> Settings:
    return Settings(
        env="test",
        cookie_secure=False,
        jwt_secret="j" * 32,
        bootstrap_token="bootstrap-token-test",
        use_in_memory_store=True,
        llm_enabled=True,
        llm_api_base_url="http://localhost:11434/v1",
        llm_model="local-model",
    )
