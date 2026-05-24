# SPDX-License-Identifier: AGPL-3.0-only
"""Deterministic LLM client for tests."""

from __future__ import annotations

import json

from cheeky_pony_backend.llm.audit import sha256_text
from cheeky_pony_backend.llm.errors import LlmClientError
from cheeky_pony_backend.llm.types import ChatMessage, LlmCompletion


class FakeLlmClient:
    """Return fixture completions keyed by prompt hash."""

    def __init__(
        self,
        *,
        responses: dict[str, str] | None = None,
        default_response: str | None = None,
        always_raise: bool = False,
    ) -> None:
        self.responses = responses or {}
        self.default_response = default_response
        self.always_raise = always_raise
        self.calls: list[list[ChatMessage]] = []

    async def complete(
        self,
        *,
        model: str,
        messages: list[ChatMessage],
        max_tokens: int,
        temperature: float = 0.2,
    ) -> LlmCompletion:
        """Return a deterministic completion or raise for failure-path tests."""

        del max_tokens, temperature
        self.calls.append(messages)
        if self.always_raise:
            raise LlmClientError()
        prompt_hash = sha256_text("\n".join(message.content for message in messages))
        content = self.responses.get(prompt_hash, self.default_response or _default_response())
        return LlmCompletion(
            content=content,
            model=model,
            tokens_input=120,
            tokens_output=80,
        )


def _default_response() -> str:
    return json.dumps(
        {
            "summary": "This alert matched a configured rule and should be reviewed.",
            "bullet_points": [
                "Check whether the related entity is in the engagement scope.",
                "Compare recent events before taking any action.",
            ],
            "confidence": "medium",
        }
    )
