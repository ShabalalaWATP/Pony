# SPDX-License-Identifier: AGPL-3.0-only
"""LLM insight orchestration service."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from time import monotonic

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.oui_lookup import OuiService
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.infra.pcap_analysis_store import PcapAnalysisStore
from cheeky_pony_backend.infra.pcap_store import PcapStore
from cheeky_pony_backend.llm.audit import sha256_text
from cheeky_pony_backend.llm.budget import UsageLedger
from cheeky_pony_backend.llm.cache import InsightCache
from cheeky_pony_backend.llm.client import LlmClient
from cheeky_pony_backend.llm.errors import LlmEntityNotFoundError, LlmInsightUnavailableError
from cheeky_pony_backend.llm.insights.alert_context import build_alert_context
from cheeky_pony_backend.llm.insights.ap_description import (
    build_ap_description_context,
    normalize_bssid,
)
from cheeky_pony_backend.llm.insights.engagement_summary import build_engagement_summary_context
from cheeky_pony_backend.llm.insights.pcap_finding import build_pcap_finding_context
from cheeky_pony_backend.llm.prompts import PromptTemplates
from cheeky_pony_backend.llm.redactor import PromptRedactor
from cheeky_pony_backend.llm.runtime_flags import LlmRuntimeFlags, llm_effectively_enabled
from cheeky_pony_backend.llm.service_audit import audit_unavailable
from cheeky_pony_backend.llm.service_helpers import (
    InsightResponse,
    ap_cache_expiry,
    engagement_cache_expiry,
    parse_alert_response,
    parse_ap_description_response,
    parse_engagement_response,
    parse_pcap_finding_response,
)
from cheeky_pony_backend.llm.service_runtime import (
    InsightGenerationRequest,
    InsightGenerationRuntime,
)
from cheeky_pony_backend.llm.types import Insight, InsightKind


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
        runtime_flags: LlmRuntimeFlags | None = None,
        pcap_store: PcapStore | None = None,
        pcap_analysis_store: PcapAnalysisStore | None = None,
        oui: OuiService | None = None,
    ) -> None:
        self._redactor = redactor
        self._templates = templates
        self._audit = audit
        self._settings = settings
        self._store = store
        self._runtime_flags = runtime_flags
        self._pcap_store = pcap_store
        self._pcap_analysis_store = pcap_analysis_store
        self._oui = oui
        self._runtime = InsightGenerationRuntime(
            audit=audit,
            cache=cache,
            client=client,
            ledger=ledger,
            settings=settings,
        )

    async def alert_context(
        self,
        alert_id: str,
        *,
        actor_id: str,
        force_refresh: bool = False,
        audit_action: str | None = None,
    ) -> Insight:
        """Generate or return cached context for an alert."""

        async def load_context() -> object | None:
            return await build_alert_context(self._store, alert_id)

        return await self._insight_from_loader(
            actor_id=actor_id,
            entity_id=alert_id,
            kind="alert_context",
            target={"kind": "alert", "id": alert_id},
            load_context=load_context,
            expires_at=None,
            parse_response=parse_alert_response,
            force_refresh=force_refresh,
            audit_action=audit_action,
        )

    async def engagement_summary(
        self,
        engagement_id: str,
        *,
        actor_id: str,
        force_refresh: bool = False,
        audit_action: str | None = None,
    ) -> Insight:
        """Generate or return cached summary for an engagement."""

        async def load_context() -> object | None:
            return await build_engagement_summary_context(
                self._store,
                engagement_id,
                pcap_store=self._pcap_store,
                analysis_store=self._pcap_analysis_store,
            )

        return await self._insight_from_loader(
            actor_id=actor_id,
            entity_id=engagement_id,
            kind="engagement_summary",
            target={"kind": "engagement", "id": engagement_id},
            load_context=load_context,
            expires_at=engagement_cache_expiry(),
            parse_response=parse_engagement_response,
            force_refresh=force_refresh,
            audit_action=audit_action,
        )

    async def ap_description(
        self,
        bssid: str,
        *,
        actor_id: str,
        force_refresh: bool = False,
        audit_action: str | None = None,
    ) -> Insight:
        """Generate or return cached description for one access point."""

        normalized = normalize_bssid(bssid)
        entity_id = normalized or bssid.lower()

        async def load_context() -> object | None:
            if normalized is None or self._oui is None:
                return None
            return await build_ap_description_context(
                self._store,
                normalized,
                oui=self._oui,
                label_confidence_threshold=self._settings.label_confidence_threshold,
            )

        return await self._insight_from_loader(
            actor_id=actor_id,
            entity_id=entity_id,
            kind="ap_description",
            target={"kind": "access_point", "id": entity_id},
            load_context=load_context,
            expires_at=ap_cache_expiry(),
            parse_response=parse_ap_description_response,
            force_refresh=force_refresh,
            audit_action=audit_action,
        )

    async def pcap_finding(
        self,
        finding_id: str,
        *,
        actor_id: str,
        force_refresh: bool = False,
        audit_action: str | None = None,
    ) -> Insight:
        """Generate or return cached explanation for one PCAP finding."""

        async def load_context() -> object | None:
            if self._pcap_analysis_store is None:
                return None
            return await build_pcap_finding_context(
                self._store,
                self._pcap_analysis_store,
                finding_id,
            )

        return await self._insight_from_loader(
            actor_id=actor_id,
            entity_id=finding_id,
            kind="pcap_finding",
            target={"kind": "pcap_finding", "id": finding_id},
            load_context=load_context,
            expires_at=None,
            parse_response=parse_pcap_finding_response,
            force_refresh=force_refresh,
            audit_action=audit_action,
        )

    async def refresh(self, kind: InsightKind, entity_id: str, *, actor_id: str) -> Insight:
        """Force a fresh generation for one named insight kind."""

        action = f"llm.insight.{kind}.refresh"
        if kind == "alert_context":
            return await self.alert_context(
                entity_id,
                actor_id=actor_id,
                force_refresh=True,
                audit_action=action,
            )
        if kind == "engagement_summary":
            return await self.engagement_summary(
                entity_id,
                actor_id=actor_id,
                force_refresh=True,
                audit_action=action,
            )
        if kind == "ap_description":
            return await self.ap_description(
                entity_id,
                actor_id=actor_id,
                force_refresh=True,
                audit_action=action,
            )
        return await self.pcap_finding(
            entity_id,
            actor_id=actor_id,
            force_refresh=True,
            audit_action=action,
        )

    async def _insight_from_loader(
        self,
        *,
        actor_id: str,
        entity_id: str,
        kind: InsightKind,
        target: dict[str, object],
        load_context: Callable[[], Awaitable[object | None]],
        expires_at: datetime | None,
        parse_response: Callable[[str], InsightResponse],
        force_refresh: bool = False,
        audit_action: str | None = None,
    ) -> Insight:
        started_at = datetime.now(tz=UTC)
        start = monotonic()
        template = self._templates.get(kind)
        await self._reject_when_disabled(
            actor_id,
            target,
            template.version,
            start,
            started_at,
            audit_action,
        )
        context = await load_context()
        await self._reject_when_missing(
            actor_id,
            target,
            template.version,
            context,
            start,
            started_at,
            audit_action,
        )
        prompt, prompt_hash = self._render_prompt(template.content, context)
        return await self._runtime.cached_or_generate(
            InsightGenerationRequest(
                actor_id=actor_id,
                entity_id=entity_id,
                expires_at=expires_at,
                kind=kind,
                parse_response=parse_response,
                prompt=prompt,
                prompt_hash=prompt_hash,
                started_at=started_at,
                start=start,
                target=target,
                template_version=template.version,
                audit_action=audit_action,
                force_refresh=force_refresh,
            )
        )

    def _render_prompt(self, template: str, context: object) -> tuple[str, str]:
        prompt = template.replace("{{context_json}}", self._redactor.redact(context).text)
        return prompt, sha256_text(prompt)

    async def _reject_when_disabled(
        self,
        actor_id: str,
        target: dict[str, object],
        template_version: str,
        start: float,
        started_at: datetime,
        audit_action: str | None,
    ) -> None:
        if await llm_effectively_enabled(self._settings, self._runtime_flags):
            return
        await self._audit_unavailable(
            actor_id,
            target,
            template_version,
            "disabled",
            start,
            started_at,
            audit_action,
        )
        raise LlmInsightUnavailableError("disabled")

    async def _reject_when_missing(
        self,
        actor_id: str,
        target: dict[str, object],
        template_version: str,
        context: object | None,
        start: float,
        started_at: datetime,
        audit_action: str | None,
    ) -> None:
        if context is not None:
            return
        await self._audit_unavailable(
            actor_id,
            target,
            template_version,
            "refused",
            start,
            started_at,
            audit_action,
        )
        raise LlmEntityNotFoundError()

    async def _audit_unavailable(
        self,
        actor_id: str,
        target: dict[str, object],
        template_version: str,
        outcome: str,
        start: float,
        started_at: datetime,
        audit_action: str | None,
    ) -> None:
        await audit_unavailable(
            self._audit,
            actor_id=actor_id,
            target=target,
            template_version=template_version,
            outcome=outcome,
            start=start,
            started_at=started_at,
            action=audit_action,
        )
