# SPDX-License-Identifier: AGPL-3.0-only
"""Audit helpers for LLM insight generation."""

from __future__ import annotations

import hashlib
from datetime import datetime

from cheeky_pony_backend.domain.audit import AuditLogger

_TARGET_ACTIONS = {
    "access_point": "llm.insight.ap_description",
    "alert": "llm.insight.alert_context",
    "engagement": "llm.insight.engagement_summary",
    "pcap_finding": "llm.insight.pcap_finding",
}


def sha256_text(value: str) -> str:
    """Return a stable SHA-256 content hash with an explicit algorithm prefix."""

    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


async def record_llm_audit(
    audit: AuditLogger,
    *,
    actor_id: str,
    target: dict[str, object],
    prompt_hash: str | None,
    response_hash: str | None,
    model: str | None,
    template_version: str,
    tokens_input: int | None,
    tokens_output: int | None,
    cost_micro_cents: int | None,
    outcome: str,
    latency_ms: int,
    started_at: datetime,
    finished_at: datetime,
    action: str | None = None,
) -> None:
    """Record one LLM action without prompt or response content."""

    audit_outcome = "ok" if outcome in {"cached", "generated"} else "denied"
    await audit.record(
        actor_id,
        action or _TARGET_ACTIONS.get(str(target.get("kind")), "llm.insight.alert_context"),
        target,
        {
            "prompt_hash": prompt_hash,
            "response_hash": response_hash,
            "model": model,
            "template_version": template_version,
            "tokens_input": tokens_input,
            "tokens_output": tokens_output,
            "cost_micro_cents": cost_micro_cents,
            "outcome": outcome,
            "latency_ms": latency_ms,
        },
        audit_outcome,
        started_at=started_at,
        finished_at=finished_at,
    )
