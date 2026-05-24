# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for LLM-related settings validation."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from cheeky_pony_backend.config import Settings


def test_llm_enabled_https_endpoint_requires_api_key() -> None:
    """Cloud LLM endpoints require an API key when enabled."""

    with pytest.raises(ValidationError):
        Settings(
            env="test",
            cookie_secure=False,
            jwt_secret="j" * 32,
            bootstrap_token="bootstrap-token-test",
            use_in_memory_store=True,
            llm_enabled=True,
            llm_api_base_url="https://api.openai.com/v1",
        )


def test_llm_enabled_http_endpoint_allows_local_without_api_key() -> None:
    """Local OpenAI-compatible endpoints may run without an API key."""

    settings = Settings(
        env="test",
        cookie_secure=False,
        jwt_secret="j" * 32,
        bootstrap_token="bootstrap-token-test",
        use_in_memory_store=True,
        llm_enabled=True,
        llm_api_base_url="http://localhost:11434/v1",
    )

    assert settings.llm_api_key is None
