# SPDX-License-Identifier: AGPL-3.0-only
"""LLM insight orchestration service."""

from __future__ import annotations

from datetime import UTC, datetime
from time import monotonic

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.llm.audit import sha256_text
from cheeky_pony_backend.llm.budget import UsageLedger, current_budget_month
from cheeky_pony_backend.llm.cache import InsightCache, cache_key
from cheeky_pony_backend.llm.client import LlmClient
from cheeky_pony_backend.llm.errors import (
    LlmBudgetExceededError,
    LlmClientError,
    LlmEntityNotFoundError,
    LlmInsightUnavailableError,
    LlmOutputValidationError,
)
from cheeky_pony_backend.llm.insights.alert_context import (
    AlertContextResponse,
    build_alert_context,
)
from cheeky_pony_backend.llm.pricing import budget_usd_to_micro_cents
from cheeky_pony_backend.llm.prompts import PromptTemplates
from cheeky_pony_backend.llm.redactor import PromptRedactor
from cheeky_pony_backend.llm.service_audit import audit_cached, audit_generated, audit_unavailable
from cheeky_pony_backend.llm.service_helpers import (
    actual_cost,
    alert_insight,
    cache_alert_context,
    estimated_cost,
    parse_alert_response,
)
from cheeky_pony_backend.llm.types import ChatMessage, Insight, LlmCompletion


class LlmInsightService:
    """Own redaction, cache, budget, audit, validation, and dispatch."""

    def __init__(
        self,
        *,
        client: LlmClient,
        cache: InsightCache,
        ledger: UsageLedger,
        redactor: PromptRedactor,
        templates: PromptTemplates,
        audit: AuditLogger,
        settings: Settings,
        store: Store,
    ) -> None:
        self._client = client
        self._cache = cache
        self._ledger = ledger
        self._redactor = redactor
        self._templates = templates
        self._audit = audit
        self._settings = settings
        self._store = store

    async def alert_context(self, alert_id: str, *, actor_id: str) -> Insight:
        """Generate or return cached context for an alert."""

        started_at = datetime.now(tz=UTC)
        start = monotonic()
        template = self._templates.get("alert_context")
        target: dict[str, object] = {"kind": "alert", "id": alert_id}
        if not self._settings.llm_enabled:
            await audit_unavailable(
                self._audit,
                actor_id=actor_id,
                target=target,
                template_version=template.version,
                outcome="disabled",
                start=start,
                started_at=started_at,
            )
            raise LlmInsightUnavailableError("disabled")
        context = await build_alert_context(self._store, alert_id)
        if context is None:
            await audit_unavailable(
                self._audit,
                actor_id=actor_id,
                target=target,
                template_version=template.version,
                outcome="refused",
                start=start,
                started_at=started_at,
            )
            raise LlmEntityNotFoundError()
        prompt = template.content.replace("{{context_json}}", self._redactor.redact(context).text)
        prompt_hash = sha256_text(prompt)
        cached = await self._cached_insight(alert_id, prompt_hash, template.version)
        if cached is not None:
            await audit_cached(
                self._audit,
                actor_id=actor_id,
                target=target,
                prompt_hash=prompt_hash,
                template_version=template.version,
                start=start,
                started_at=started_at,
            )
            return cached
        return await self._generate_alert_context(
            alert_id,
            actor_id,
            target,
            prompt,
            prompt_hash,
            template.version,
            start,
            started_at,
        )

    async def _generate_alert_context(
        self,
        alert_id: str,
        actor_id: str,
        target: dict[str, object],
        prompt: str,
        prompt_hash: str,
        template_version: str,
        start: float,
        started_at: datetime,
    ) -> Insight:
        estimated = estimated_cost(self._settings, prompt)
        await self._reserve_budget(
            actor_id, target, prompt_hash, template_version, estimated, start, started_at
        )
        completion, response = await self._complete_alert_context(
            actor_id,
            target,
            prompt,
            prompt_hash,
            template_version,
            estimated,
            start,
            started_at,
        )
        actual = actual_cost(
            self._settings,
            tokens_input=completion.tokens_input,
            tokens_output=completion.tokens_output,
            fallback=estimated,
        )
        await self._adjust_budget(estimated, actual)
        insight = alert_insight(alert_id, response, completion, template_version)
        await cache_alert_context(
            self._cache,
            alert_id=alert_id,
            prompt_hash=prompt_hash,
            template_version=template_version,
            insight=insight,
        )
        await audit_generated(
            self._audit,
            actor_id=actor_id,
            target=target,
            prompt_hash=prompt_hash,
            response_hash=sha256_text(completion.content),
            model=completion.model,
            template_version=template_version,
            tokens_input=completion.tokens_input,
            tokens_output=completion.tokens_output,
            cost_micro_cents=actual,
            start=start,
            started_at=started_at,
        )
        return insight

    async def _complete_alert_context(
        self,
        actor_id: str,
        target: dict[str, object],
        prompt: str,
        prompt_hash: str,
        template_version: str,
        estimated_cost: int,
        start: float,
        started_at: datetime,
    ) -> tuple[LlmCompletion, AlertContextResponse]:
        try:
            completion = await self._client.complete(
                model=self._settings.llm_model,
                messages=[ChatMessage(role="user", content=prompt)],
                max_tokens=self._settings.llm_max_response_tokens,
            )
            return completion, parse_alert_response(completion.content)
        except LlmClientError:
            await self._audit_generation_failure(
                actor_id,
                target,
                "client_error",
                prompt_hash,
                template_version,
                estimated_cost,
                start,
                started_at,
            )
            raise
        except LlmOutputValidationError:
            await self._audit_generation_failure(
                actor_id,
                target,
                "validation_failed",
                prompt_hash,
                template_version,
                estimated_cost,
                start,
                started_at,
            )
            raise

    async def _cached_insight(
        self,
        alert_id: str,
        prompt_hash: str,
        template_version: str,
    ) -> Insight | None:
        record = await self._cache.get(
            cache_key(
                kind="alert_context",
                entity_id=alert_id,
                prompt_hash=prompt_hash,
                template_version=template_version,
            )
        )
        if record is None:
            return None
        return record.insight.model_copy(update={"cached": True})

    async def _audit_generation_failure(
        self,
        actor_id: str,
        target: dict[str, object],
        outcome: str,
        prompt_hash: str,
        template_version: str,
        estimated_cost: int,
        start: float,
        started_at: datetime,
    ) -> None:
        await self._release_budget(estimated_cost)
        await audit_unavailable(
            self._audit,
            actor_id=actor_id,
            target=target,
            template_version=template_version,
            outcome=outcome,
            start=start,
            started_at=started_at,
            prompt_hash=prompt_hash,
        )

    async def _reserve_budget(
        self,
        actor_id: str,
        target: dict[str, object],
        prompt_hash: str,
        template_version: str,
        estimated_cost: int,
        start: float,
        started_at: datetime,
    ) -> None:
        budget = budget_usd_to_micro_cents(self._settings.llm_budget_usd_monthly)
        month = current_budget_month()
        if await self._ledger.reserve_monthly_budget(month, estimated_cost, budget):
            return
        await audit_unavailable(
            self._audit,
            actor_id=actor_id,
            target=target,
            template_version=template_version,
            outcome="budget_exceeded",
            start=start,
            started_at=started_at,
            prompt_hash=prompt_hash,
            cost_micro_cents=estimated_cost,
        )
        raise LlmBudgetExceededError()

    async def _release_budget(self, estimated_cost: int) -> None:
        if estimated_cost:
            await self._ledger.adjust_monthly_spend(current_budget_month(), -estimated_cost)

    async def _adjust_budget(self, estimated_cost: int, actual_cost: int) -> None:
        if actual_cost != estimated_cost:
            await self._ledger.adjust_monthly_spend(
                current_budget_month(),
                actual_cost - estimated_cost,
            )
