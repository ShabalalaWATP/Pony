# SPDX-License-Identifier: AGPL-3.0-only
"""LLM usage telemetry models and aggregation."""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime, timedelta

from pydantic import BaseModel, ConfigDict, Field

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.llm.budget import UsageLedger, current_budget_month
from cheeky_pony_backend.llm.pricing import budget_usd_to_micro_cents
from cheeky_pony_shared import AuditLog

_LLM_ACTION_PREFIX = "llm.insight."
_AUDIT_SCAN_LIMIT = 1_000
_RECENT_AUDIT_LIMIT = 50
_USAGE_WINDOW = timedelta(days=30)


class LlmKindUsage(BaseModel):
    """Generation/cache counts for one insight kind."""

    model_config = ConfigDict(extra="forbid")

    cached: int = Field(ge=0)
    generated: int = Field(ge=0)
    kind: str = Field(min_length=1, max_length=64)


class LlmAuditSummary(BaseModel):
    """Prompt-safe LLM audit summary."""

    model_config = ConfigDict(extra="forbid")

    action: str
    cost_micro_cents: int | None
    model: str | None
    occurred_at: datetime
    outcome: str
    prompt_hash: str | None
    response_hash: str | None
    target_id: str | None
    target_kind: str | None
    tokens_input: int | None
    tokens_output: int | None


class LlmUsageResponse(BaseModel):
    """Admin-facing LLM usage telemetry."""

    model_config = ConfigDict(extra="forbid")

    budget_micro_cents: int | None
    budget_remaining_micro_cents: int | None
    budget_remaining_usd: str
    current_month: str
    current_month_spend_micro_cents: int
    current_month_spend_usd: str
    last_30_days: list[LlmKindUsage]
    recent_audit_entries: list[LlmAuditSummary]


async def build_usage_response(
    store: Store,
    ledger: UsageLedger,
    settings: Settings,
) -> LlmUsageResponse:
    """Build current LLM usage telemetry from ledger and audit metadata."""

    month = current_budget_month()
    spend = await ledger.current_month_spend(month)
    budget = _budget(settings)
    entries = await _llm_audit_entries(store)
    return LlmUsageResponse(
        budget_micro_cents=budget,
        budget_remaining_micro_cents=_remaining_budget(budget, spend),
        budget_remaining_usd=_remaining_label(budget, spend),
        current_month=month,
        current_month_spend_micro_cents=spend,
        current_month_spend_usd=_usd_label(spend),
        last_30_days=_kind_usage(entries),
        recent_audit_entries=[_audit_summary(entry) for entry in entries[:_RECENT_AUDIT_LIMIT]],
    )


async def _llm_audit_entries(store: Store) -> list[AuditLog]:
    entries, _ = await store.list_audit(_AUDIT_SCAN_LIMIT, 0)
    llm_entries = [entry for entry in entries if entry.action.startswith("llm.")]
    return sorted(llm_entries, key=lambda entry: entry.occurred_at, reverse=True)


def _kind_usage(entries: list[AuditLog]) -> list[LlmKindUsage]:
    cutoff = datetime.now(tz=UTC) - _USAGE_WINDOW
    generated: Counter[str] = Counter()
    cached: Counter[str] = Counter()
    for entry in entries:
        if entry.occurred_at < cutoff or not entry.action.startswith(_LLM_ACTION_PREFIX):
            continue
        outcome = _string_parameter(entry, "outcome")
        kind = _kind_from_action(entry.action)
        if outcome == "generated":
            generated[kind] += 1
        if outcome == "cached":
            cached[kind] += 1
    kinds = sorted(set(generated) | set(cached))
    return [
        LlmKindUsage(kind=kind, generated=generated[kind], cached=cached[kind]) for kind in kinds
    ]


def _audit_summary(entry: AuditLog) -> LlmAuditSummary:
    return LlmAuditSummary(
        action=entry.action,
        cost_micro_cents=_int_parameter(entry, "cost_micro_cents"),
        model=_string_parameter(entry, "model"),
        occurred_at=entry.occurred_at,
        outcome=_string_parameter(entry, "outcome") or entry.outcome,
        prompt_hash=_string_parameter(entry, "prompt_hash"),
        response_hash=_string_parameter(entry, "response_hash"),
        target_id=_target_value(entry, "id"),
        target_kind=_target_value(entry, "kind"),
        tokens_input=_int_parameter(entry, "tokens_input"),
        tokens_output=_int_parameter(entry, "tokens_output"),
    )


def _kind_from_action(action: str) -> str:
    suffix = action.removeprefix(_LLM_ACTION_PREFIX)
    return suffix.removesuffix(".refresh")


def _budget(settings: Settings) -> int | None:
    budget = budget_usd_to_micro_cents(settings.llm_budget_usd_monthly)
    return budget if budget > 0 else None


def _remaining_budget(budget: int | None, spend: int) -> int | None:
    return None if budget is None else max(0, budget - spend)


def _remaining_label(budget: int | None, spend: int) -> str:
    remaining = _remaining_budget(budget, spend)
    return "unlimited" if remaining is None else _usd_label(remaining)


def _usd_label(micro_cents: int) -> str:
    return f"${micro_cents / 100_000_000:.6f}"


def _string_parameter(entry: AuditLog, key: str) -> str | None:
    value = entry.parameters.get(key)
    return value if isinstance(value, str) else None


def _int_parameter(entry: AuditLog, key: str) -> int | None:
    value = entry.parameters.get(key)
    return value if isinstance(value, int) else None


def _target_value(entry: AuditLog, key: str) -> str | None:
    value = entry.target.get(key)
    return value if isinstance(value, str) else None
