# SPDX-License-Identifier: AGPL-3.0-only
"""Small helpers for LLM insight service orchestration."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Protocol

from pydantic import ValidationError

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.llm.audit import sha256_text
from cheeky_pony_backend.llm.cache import InsightCache, cache_key, cache_record
from cheeky_pony_backend.llm.errors import LlmOutputValidationError
from cheeky_pony_backend.llm.insights.alert_context import AlertContextResponse
from cheeky_pony_backend.llm.insights.ap_description import ApDescriptionResponse
from cheeky_pony_backend.llm.insights.engagement_summary import EngagementSummaryResponse
from cheeky_pony_backend.llm.pricing import (
    estimate_completion_cost_micro_cents,
    estimate_tokens,
)
from cheeky_pony_backend.llm.service_audit import audit_generated
from cheeky_pony_backend.llm.types import Insight, InsightConfidence, InsightKind, LlmCompletion


class InsightResponse(Protocol):
    """Common validated response shape returned by insight-specific schemas."""

    summary: str
    bullet_points: list[str]
    confidence: InsightConfidence


def parse_alert_response(content: str) -> AlertContextResponse:
    """Parse and validate an alert-context model response."""

    try:
        parsed = json.loads(content)
        return AlertContextResponse.model_validate(parsed)
    except (json.JSONDecodeError, ValidationError) as exc:
        raise LlmOutputValidationError() from exc


def parse_engagement_response(content: str) -> EngagementSummaryResponse:
    """Parse and validate an engagement-summary model response."""

    try:
        parsed = json.loads(content)
        return EngagementSummaryResponse.model_validate(parsed)
    except (json.JSONDecodeError, ValidationError) as exc:
        raise LlmOutputValidationError() from exc


def parse_ap_description_response(content: str) -> ApDescriptionResponse:
    """Parse and validate an AP-description model response."""

    try:
        parsed = json.loads(content)
        return ApDescriptionResponse.model_validate(parsed)
    except (json.JSONDecodeError, ValidationError) as exc:
        raise LlmOutputValidationError() from exc


def public_insight(
    kind: InsightKind,
    entity_id: str,
    response: InsightResponse,
    completion: LlmCompletion,
    template_version: str,
) -> Insight:
    """Build the public insight model for a validated response."""

    return Insight(
        kind=kind,
        entity_id=entity_id,
        summary=response.summary,
        bullet_points=response.bullet_points,
        confidence=response.confidence,
        generated_at=datetime.now(tz=UTC),
        model=completion.model,
        template_version=template_version,
        cached=False,
    )


async def cache_insight(
    cache: InsightCache,
    *,
    kind: InsightKind,
    entity_id: str,
    prompt_hash: str,
    template_version: str,
    insight: Insight,
    expires_at: datetime | None,
) -> None:
    """Persist an insight cache record."""

    await cache.set(
        cache_record(
            key=cache_key(
                kind=kind,
                entity_id=entity_id,
                prompt_hash=prompt_hash,
                template_version=template_version,
            ),
            kind=kind,
            entity_id=entity_id,
            prompt_hash=prompt_hash,
            template_version=template_version,
            insight=insight,
            expires_at=expires_at,
        )
    )


async def cache_and_audit_generated(
    cache: InsightCache,
    audit: AuditLogger,
    *,
    kind: InsightKind,
    entity_id: str,
    response: InsightResponse,
    completion: LlmCompletion,
    actor_id: str,
    target: dict[str, object],
    prompt_hash: str,
    template_version: str,
    expires_at: datetime | None,
    cost_micro_cents: int,
    start: float,
    started_at: datetime,
) -> Insight:
    """Persist and audit a freshly generated insight."""

    insight = public_insight(kind, entity_id, response, completion, template_version)
    await cache_insight(
        cache,
        kind=kind,
        entity_id=entity_id,
        prompt_hash=prompt_hash,
        template_version=template_version,
        insight=insight,
        expires_at=expires_at,
    )
    await audit_generated(
        audit,
        actor_id=actor_id,
        target=target,
        prompt_hash=prompt_hash,
        response_hash=sha256_text(completion.content),
        model=completion.model,
        template_version=template_version,
        tokens_input=completion.tokens_input,
        tokens_output=completion.tokens_output,
        cost_micro_cents=cost_micro_cents,
        start=start,
        started_at=started_at,
    )
    return insight


def engagement_cache_expiry() -> datetime:
    """Return the conservative engagement-summary cache expiry."""

    return datetime.now(tz=UTC) + timedelta(hours=1)


def ap_cache_expiry() -> datetime:
    """Return the conservative AP-description cache expiry."""

    return datetime.now(tz=UTC) + timedelta(hours=24)


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
