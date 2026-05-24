# SPDX-License-Identifier: AGPL-3.0-only
"""Small helpers for LLM insight service orchestration."""

from __future__ import annotations

import json
from datetime import UTC, datetime

from pydantic import ValidationError

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.llm.cache import InsightCache, cache_key, cache_record
from cheeky_pony_backend.llm.errors import LlmOutputValidationError
from cheeky_pony_backend.llm.insights.alert_context import AlertContextResponse
from cheeky_pony_backend.llm.pricing import (
    estimate_completion_cost_micro_cents,
    estimate_tokens,
)
from cheeky_pony_backend.llm.types import Insight, LlmCompletion


def parse_alert_response(content: str) -> AlertContextResponse:
    """Parse and validate an alert-context model response."""

    try:
        parsed = json.loads(content)
        return AlertContextResponse.model_validate(parsed)
    except (json.JSONDecodeError, ValidationError) as exc:
        raise LlmOutputValidationError() from exc


def alert_insight(
    alert_id: str,
    response: AlertContextResponse,
    completion: LlmCompletion,
    template_version: str,
) -> Insight:
    """Build the public insight model for a validated alert response."""

    return Insight(
        kind="alert_context",
        entity_id=alert_id,
        summary=response.summary,
        bullet_points=response.bullet_points,
        confidence=response.confidence,
        generated_at=datetime.now(tz=UTC),
        model=completion.model,
        template_version=template_version,
        cached=False,
    )


async def cache_alert_context(
    cache: InsightCache,
    *,
    alert_id: str,
    prompt_hash: str,
    template_version: str,
    insight: Insight,
) -> None:
    """Persist an alert-context insight cache record."""

    await cache.set(
        cache_record(
            key=cache_key(
                kind="alert_context",
                entity_id=alert_id,
                prompt_hash=prompt_hash,
                template_version=template_version,
            ),
            kind="alert_context",
            entity_id=alert_id,
            prompt_hash=prompt_hash,
            template_version=template_version,
            insight=insight,
            expires_at=None,
        )
    )


def actual_cost(
    settings: Settings,
    *,
    tokens_input: int | None,
    tokens_output: int | None,
    fallback: int,
) -> int:
    """Return actual completion cost when token usage is available."""

    if tokens_input is None or tokens_output is None:
        return fallback
    return estimate_completion_cost_micro_cents(
        settings.llm_model,
        input_tokens=tokens_input,
        output_tokens=tokens_output,
    )


def estimated_cost(settings: Settings, prompt: str) -> int:
    """Return conservative preflight cost for a prompt."""

    return estimate_completion_cost_micro_cents(
        settings.llm_model,
        input_tokens=estimate_tokens(prompt),
        output_tokens=settings.llm_max_response_tokens,
    )
