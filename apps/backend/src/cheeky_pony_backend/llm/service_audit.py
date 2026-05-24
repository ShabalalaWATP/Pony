# SPDX-License-Identifier: AGPL-3.0-only
"""Service-level LLM audit outcomes."""

from __future__ import annotations

from datetime import UTC, datetime
from time import monotonic

from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.llm.audit import record_llm_audit


async def audit_cached(
    audit: AuditLogger,
    *,
    actor_id: str,
    target: dict[str, object],
    prompt_hash: str,
    template_version: str,
    start: float,
    started_at: datetime,
    action: str | None = None,
) -> None:
    """Record a cache-hit insight read."""

    await record_llm_audit(
        audit,
        actor_id=actor_id,
        target=target,
        prompt_hash=prompt_hash,
        response_hash=None,
        model=None,
        template_version=template_version,
        tokens_input=None,
        tokens_output=None,
        cost_micro_cents=None,
        outcome="cached",
        latency_ms=latency_ms(start),
        started_at=started_at,
        finished_at=datetime.now(tz=UTC),
        action=action,
    )


async def audit_generated(
    audit: AuditLogger,
    *,
    actor_id: str,
    target: dict[str, object],
    prompt_hash: str,
    response_hash: str,
    model: str,
    template_version: str,
    tokens_input: int | None,
    tokens_output: int | None,
    cost_micro_cents: int,
    start: float,
    started_at: datetime,
    action: str | None = None,
) -> None:
    """Record a freshly generated insight."""

    await record_llm_audit(
        audit,
        actor_id=actor_id,
        target=target,
        prompt_hash=prompt_hash,
        response_hash=response_hash,
        model=model,
        template_version=template_version,
        tokens_input=tokens_input,
        tokens_output=tokens_output,
        cost_micro_cents=cost_micro_cents,
        outcome="generated",
        latency_ms=latency_ms(start),
        started_at=started_at,
        finished_at=datetime.now(tz=UTC),
        action=action,
    )


async def audit_unavailable(
    audit: AuditLogger,
    *,
    actor_id: str,
    target: dict[str, object],
    template_version: str,
    outcome: str,
    start: float,
    started_at: datetime,
    prompt_hash: str | None = None,
    cost_micro_cents: int | None = None,
    action: str | None = None,
) -> None:
    """Record a refused or unavailable insight path."""

    await record_llm_audit(
        audit,
        actor_id=actor_id,
        target=target,
        prompt_hash=prompt_hash,
        response_hash=None,
        model=None,
        template_version=template_version,
        tokens_input=None,
        tokens_output=None,
        cost_micro_cents=cost_micro_cents,
        outcome=outcome,
        latency_ms=latency_ms(start),
        started_at=started_at,
        finished_at=datetime.now(tz=UTC),
        action=action,
    )


def latency_ms(start: float) -> int:
    """Return elapsed milliseconds from a monotonic start timestamp."""

    return int((monotonic() - start) * 1000)
