# SPDX-License-Identifier: AGPL-3.0-only
"""LLM insight orchestration service."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from time import monotonic

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.infra.pcap_analysis_store import PcapAnalysisStore
from cheeky_pony_backend.infra.pcap_store import PcapStore
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
from cheeky_pony_backend.llm.insights.alert_context import build_alert_context
from cheeky_pony_backend.llm.insights.engagement_summary import build_engagement_summary_context
from cheeky_pony_backend.llm.pricing import budget_usd_to_micro_cents
from cheeky_pony_backend.llm.prompts import PromptTemplates
from cheeky_pony_backend.llm.redactor import PromptRedactor
from cheeky_pony_backend.llm.service_audit import audit_cached, audit_unavailable
from cheeky_pony_backend.llm.service_helpers import (
    InsightResponse,
    actual_cost,
    cache_and_audit_generated,
    engagement_cache_expiry,
    estimated_cost,
    parse_alert_response,
    parse_engagement_response,
)
from cheeky_pony_backend.llm.types import ChatMessage, Insight, InsightKind, LlmCompletion


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
        pcap_store: PcapStore | None = None,
        pcap_analysis_store: PcapAnalysisStore | None = None,
    ) -> None:
        self._client = client
        self._cache = cache
        self._ledger = ledger
        self._redactor = redactor
        self._templates = templates
        self._audit = audit
        self._settings = settings
        self._store = store
        self._pcap_store = pcap_store
        self._pcap_analysis_store = pcap_analysis_store

    async def alert_context(self, alert_id: str, *, actor_id: str) -> Insight:
        """Generate or return cached context for an alert."""

        started_at = datetime.now(tz=UTC)
        start = monotonic()
        template = self._templates.get("alert_context")
        target: dict[str, object] = {"kind": "alert", "id": alert_id}
        if not self._settings.llm_enabled:
            await self._audit_unavailable(
                actor_id, target, template.version, "disabled", start, started_at
            )
            raise LlmInsightUnavailableError("disabled")
        context = await build_alert_context(self._store, alert_id)
        if context is None:
            await self._audit_unavailable(
                actor_id, target, template.version, "refused", start, started_at
            )
            raise LlmEntityNotFoundError()
        prompt, prompt_hash = self._render_prompt(template.content, context)
        return await self._cached_or_generate(
            kind="alert_context",
            entity_id=alert_id,
            actor_id=actor_id,
            target=target,
            prompt=prompt,
            prompt_hash=prompt_hash,
            template_version=template.version,
            expires_at=None,
            parse_response=parse_alert_response,
            start=start,
            started_at=started_at,
        )

    async def engagement_summary(self, engagement_id: str, *, actor_id: str) -> Insight:
        """Generate or return cached summary for an engagement."""

        started_at = datetime.now(tz=UTC)
        start = monotonic()
        template = self._templates.get("engagement_summary")
        target: dict[str, object] = {"kind": "engagement", "id": engagement_id}
        if not self._settings.llm_enabled:
            await self._audit_unavailable(
                actor_id, target, template.version, "disabled", start, started_at
            )
            raise LlmInsightUnavailableError("disabled")
        context = await build_engagement_summary_context(
            self._store,
            engagement_id,
            pcap_store=self._pcap_store,
            analysis_store=self._pcap_analysis_store,
        )
        if context is None:
            await self._audit_unavailable(
                actor_id, target, template.version, "refused", start, started_at
            )
            raise LlmEntityNotFoundError()
        prompt, prompt_hash = self._render_prompt(template.content, context)
        return await self._cached_or_generate(
            kind="engagement_summary",
            entity_id=engagement_id,
            actor_id=actor_id,
            target=target,
            prompt=prompt,
            prompt_hash=prompt_hash,
            template_version=template.version,
            expires_at=engagement_cache_expiry(),
            parse_response=parse_engagement_response,
            start=start,
            started_at=started_at,
        )

    def _render_prompt(self, template: str, context: object) -> tuple[str, str]:
        prompt = template.replace("{{context_json}}", self._redactor.redact(context).text)
        return prompt, sha256_text(prompt)

    async def _audit_unavailable(
        self,
        actor_id: str,
        target: dict[str, object],
        template_version: str,
        outcome: str,
        start: float,
        started_at: datetime,
    ) -> None:
        await audit_unavailable(
            self._audit,
            actor_id=actor_id,
            target=target,
            template_version=template_version,
            outcome=outcome,
            start=start,
            started_at=started_at,
        )

    async def _cached_or_generate(
        self,
        *,
        kind: InsightKind,
        entity_id: str,
        actor_id: str,
        target: dict[str, object],
        prompt: str,
        prompt_hash: str,
        template_version: str,
        expires_at: datetime | None,
        parse_response: Callable[[str], InsightResponse],
        start: float,
        started_at: datetime,
    ) -> Insight:
        cached = await self._cached_insight(kind, entity_id, prompt_hash, template_version)
        if cached is not None:
            await audit_cached(
                self._audit,
                actor_id=actor_id,
                target=target,
                prompt_hash=prompt_hash,
                template_version=template_version,
                start=start,
                started_at=started_at,
            )
            return cached
        return await self._generate_insight(
            kind=kind,
            entity_id=entity_id,
            actor_id=actor_id,
            target=target,
            prompt=prompt,
            prompt_hash=prompt_hash,
            template_version=template_version,
            expires_at=expires_at,
            parse_response=parse_response,
            start=start,
            started_at=started_at,
        )

    async def _generate_insight(
        self,
        *,
        kind: InsightKind,
        entity_id: str,
        actor_id: str,
        target: dict[str, object],
        prompt: str,
        prompt_hash: str,
        template_version: str,
        expires_at: datetime | None,
        parse_response: Callable[[str], InsightResponse],
        start: float,
        started_at: datetime,
    ) -> Insight:
        estimated = estimated_cost(self._settings, prompt)
        await self._reserve_budget(
            actor_id, target, prompt_hash, template_version, estimated, start, started_at
        )
        completion, response = await self._complete_insight(
            actor_id,
            target,
            prompt,
            prompt_hash,
            template_version,
            estimated,
            start,
            started_at,
            parse_response,
        )
        actual = self._actual_cost(completion, estimated)
        await self._adjust_budget(estimated, actual)
        return await cache_and_audit_generated(
            self._cache,
            self._audit,
            kind=kind,
            entity_id=entity_id,
            response=response,
            completion=completion,
            actor_id=actor_id,
            target=target,
            prompt_hash=prompt_hash,
            template_version=template_version,
            expires_at=expires_at,
            cost_micro_cents=actual,
            start=start,
            started_at=started_at,
        )

    async def _complete_insight(
        self,
        actor_id: str,
        target: dict[str, object],
        prompt: str,
        prompt_hash: str,
        template_version: str,
        estimated_cost: int,
        start: float,
        started_at: datetime,
        parse_response: Callable[[str], InsightResponse],
    ) -> tuple[LlmCompletion, InsightResponse]:
        try:
            completion = await self._client.complete(
                model=self._settings.llm_model,
                messages=[ChatMessage(role="user", content=prompt)],
                max_tokens=self._settings.llm_max_response_tokens,
            )
            return completion, parse_response(completion.content)
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

    def _actual_cost(self, completion: LlmCompletion, estimated: int) -> int:
        return actual_cost(
            self._settings,
            tokens_input=completion.tokens_input,
            tokens_output=completion.tokens_output,
            fallback=estimated,
        )

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
