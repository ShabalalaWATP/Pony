# SPDX-License-Identifier: AGPL-3.0-only
"""Shared LLM insight generation runtime."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.llm.budget import UsageLedger, current_budget_month
from cheeky_pony_backend.llm.cache import InsightCache, cache_key
from cheeky_pony_backend.llm.client import LlmClient
from cheeky_pony_backend.llm.errors import (
    LlmBudgetExceededError,
    LlmClientError,
    LlmOutputValidationError,
)
from cheeky_pony_backend.llm.pricing import budget_usd_to_micro_cents
from cheeky_pony_backend.llm.service_audit import audit_cached, audit_unavailable
from cheeky_pony_backend.llm.service_helpers import (
    InsightResponse,
    actual_cost,
    cache_and_audit_generated,
    estimated_cost,
)
from cheeky_pony_backend.llm.types import ChatMessage, Insight, InsightKind, LlmCompletion


@dataclass(frozen=True)
class InsightGenerationRequest:
    """Inputs required to generate or read one insight."""

    actor_id: str
    entity_id: str
    expires_at: datetime | None
    kind: InsightKind
    parse_response: Callable[[str], InsightResponse]
    prompt: str
    prompt_hash: str
    started_at: datetime
    start: float
    target: dict[str, object]
    template_version: str
    audit_action: str | None = None
    force_refresh: bool = False


class InsightGenerationRuntime:
    """Own cache, budget, client dispatch, output validation, and audit."""

    def __init__(
        self,
        *,
        audit: AuditLogger,
        cache: InsightCache,
        client: LlmClient,
        ledger: UsageLedger,
        settings: Settings,
    ) -> None:
        self._audit = audit
        self._cache = cache
        self._client = client
        self._ledger = ledger
        self._settings = settings

    async def cached_or_generate(self, request: InsightGenerationRequest) -> Insight:
        """Return a cached insight or dispatch a fresh model completion."""

        cached = (
            None
            if request.force_refresh
            else await self._cached_insight(
                request.kind,
                request.entity_id,
                request.prompt_hash,
                request.template_version,
            )
        )
        if cached is not None:
            await audit_cached(
                self._audit,
                actor_id=request.actor_id,
                target=request.target,
                prompt_hash=request.prompt_hash,
                template_version=request.template_version,
                start=request.start,
                started_at=request.started_at,
                action=request.audit_action,
            )
            return cached
        return await self._generate_insight(request)

    async def _generate_insight(self, request: InsightGenerationRequest) -> Insight:
        estimated = estimated_cost(self._settings, request.prompt)
        await self._reserve_budget(request, estimated)
        completion, response = await self._complete_insight(request, estimated)
        actual = self._actual_cost(completion, estimated)
        await self._adjust_budget(estimated, actual)
        return await cache_and_audit_generated(
            self._cache,
            self._audit,
            kind=request.kind,
            entity_id=request.entity_id,
            response=response,
            completion=completion,
            actor_id=request.actor_id,
            target=request.target,
            prompt_hash=request.prompt_hash,
            template_version=request.template_version,
            expires_at=request.expires_at,
            cost_micro_cents=actual,
            start=request.start,
            started_at=request.started_at,
            audit_action=request.audit_action,
        )

    async def _complete_insight(
        self,
        request: InsightGenerationRequest,
        estimated_cost_micro_cents: int,
    ) -> tuple[LlmCompletion, InsightResponse]:
        try:
            completion = await self._client.complete(
                model=self._settings.llm_model,
                messages=[ChatMessage(role="user", content=request.prompt)],
                max_tokens=self._settings.llm_max_response_tokens,
            )
            return completion, request.parse_response(completion.content)
        except LlmClientError:
            await self._audit_generation_failure(
                request,
                "client_error",
                estimated_cost_micro_cents,
            )
            raise
        except LlmOutputValidationError:
            await self._audit_generation_failure(
                request,
                "validation_failed",
                estimated_cost_micro_cents,
            )
            raise

    async def _cached_insight(
        self,
        kind: InsightKind,
        entity_id: str,
        prompt_hash: str,
        template_version: str,
    ) -> Insight | None:
        record = await self._cache.get(
            cache_key(
                kind=kind,
                entity_id=entity_id,
                prompt_hash=prompt_hash,
                template_version=template_version,
            )
        )
        if record is None:
            return None
        return record.insight.model_copy(update={"cached": True})

    async def _audit_generation_failure(
        self,
        request: InsightGenerationRequest,
        outcome: str,
        estimated_cost_micro_cents: int,
    ) -> None:
        await self._release_budget(estimated_cost_micro_cents)
        await audit_unavailable(
            self._audit,
            actor_id=request.actor_id,
            target=request.target,
            template_version=request.template_version,
            outcome=outcome,
            start=request.start,
            started_at=request.started_at,
            prompt_hash=request.prompt_hash,
            action=request.audit_action,
        )

    async def _reserve_budget(
        self,
        request: InsightGenerationRequest,
        estimated_cost_micro_cents: int,
    ) -> None:
        budget = budget_usd_to_micro_cents(self._settings.llm_budget_usd_monthly)
        month = current_budget_month()
        if await self._ledger.reserve_monthly_budget(month, estimated_cost_micro_cents, budget):
            return
        await audit_unavailable(
            self._audit,
            actor_id=request.actor_id,
            target=request.target,
            template_version=request.template_version,
            outcome="budget_exceeded",
            start=request.start,
            started_at=request.started_at,
            prompt_hash=request.prompt_hash,
            cost_micro_cents=estimated_cost_micro_cents,
            action=request.audit_action,
        )
        raise LlmBudgetExceededError()

    def _actual_cost(self, completion: LlmCompletion, estimated_cost_micro_cents: int) -> int:
        return actual_cost(
            self._settings,
            tokens_input=completion.tokens_input,
            tokens_output=completion.tokens_output,
            fallback=estimated_cost_micro_cents,
        )

    async def _release_budget(self, estimated_cost_micro_cents: int) -> None:
        if estimated_cost_micro_cents:
            await self._ledger.adjust_monthly_spend(
                current_budget_month(),
                -estimated_cost_micro_cents,
            )

    async def _adjust_budget(self, estimated_cost_micro_cents: int, actual_cost_value: int) -> None:
        if actual_cost_value != estimated_cost_micro_cents:
            await self._ledger.adjust_monthly_spend(
                current_budget_month(),
                actual_cost_value - estimated_cost_micro_cents,
            )
