# SPDX-License-Identifier: AGPL-3.0-only
"""arq task entrypoints for backend background work."""

from __future__ import annotations

import base64
from datetime import UTC, datetime
from typing import Any, cast

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.alerts import AlertRuleEngine
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.oui_lookup import OuiService
from cheeky_pony_backend.domain.pcap_models import PcapStatus
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.report_capture_findings import (
    CaptureFindingsSection,
    build_capture_findings_section,
)
from cheeky_pony_backend.domain.reports import ReportStatus, render_report_artifact
from cheeky_pony_backend.infra.pcap_analysis_store import PcapAnalysisStore
from cheeky_pony_backend.infra.pcap_store import PcapStore
from cheeky_pony_backend.llm.budget import UsageLedger
from cheeky_pony_backend.llm.cache import InsightCache
from cheeky_pony_backend.llm.client import LlmClient
from cheeky_pony_backend.llm.errors import LlmEntityNotFoundError, LlmInsightUnavailableError
from cheeky_pony_backend.llm.prompts import PromptTemplates
from cheeky_pony_backend.llm.redactor import PromptRedactor
from cheeky_pony_backend.llm.service import LlmInsightService
from cheeky_pony_backend.pcap.analyzer import PcapAnalyzer
from cheeky_pony_backend.pcap.findings import AnalysisRun, AnalysisRunStatus, Finding
from cheeky_pony_backend.pcap.tshark import TsharkRunner
from cheeky_pony_shared import Event


async def batch_insert_events(ctx: dict[str, Any], events: list[dict[str, Any]]) -> int:
    """Insert a batch of event payloads.

    Args:
        ctx: arq context.
        events: Event dictionaries.

    Returns:
        Number of events accepted for insertion.
    """

    store = _store_from_context(ctx)
    if store is None:
        return len(events)

    inserted = 0
    engine = AlertRuleEngine(store)
    for payload in events:
        event = Event.model_validate(payload)
        await store.insert_event(event)
        alerts = await engine.evaluate_event(event)
        for alert in alerts:
            await generate_alert_context_insight(ctx, alert.id)
        inserted += 1
    return inserted


async def enrich_oui_vendor(ctx: dict[str, Any], mac: str) -> str | None:
    """Enrich a MAC address with OUI vendor metadata.

    Args:
        ctx: arq context.
        mac: MAC address.

    Returns:
        Vendor name when found.
    """

    _ = ctx
    return None if not mac else "unknown"


async def evaluate_alerts(ctx: dict[str, Any], event: dict[str, Any]) -> list[dict[str, Any]]:
    """Evaluate alert rules for one event.

    Args:
        ctx: arq context.
        event: Event dictionary.

    Returns:
        Alert dictionaries.
    """

    store = _store_from_context(ctx)
    if store is None:
        return []
    alerts = await AlertRuleEngine(store).evaluate_event(Event.model_validate(event))
    for alert in alerts:
        await generate_alert_context_insight(ctx, alert.id)
    return [alert.model_dump(mode="json") for alert in alerts]


async def generate_alert_context_insight(ctx: dict[str, Any], alert_id: str) -> bool:
    """Generate alert-context insight from worker context when LLM is enabled."""

    service = _llm_service_from_context(ctx)
    settings = _settings_from_context(ctx)
    if service is None or settings is None or not settings.llm_enabled:
        return False
    try:
        await service.alert_context(alert_id, actor_id="system:alert_engine")
        return True
    except (LlmEntityNotFoundError, LlmInsightUnavailableError):
        return False


async def generate_report(ctx: dict[str, Any], report_id: str) -> bool:
    """Generate one engagement report artifact.

    Args:
        ctx: arq context.
        report_id: Report identifier.

    Returns:
        Whether generation completed.
    """

    store = _store_from_context(ctx)
    if store is None:
        return False
    report = await store.get_report_by_id(report_id)
    if report is None:
        return False
    try:
        engagement = await store.get_engagement(report.engagement_id)
        if engagement is None:
            raise ValueError("engagement_not_found")
        events, _ = await store.list_events(500, 0)
        alerts, _ = await store.list_alerts(500, 0, None, None)
        audit_logs, _ = await store.list_audit(500, 0)
        capture_findings = await _capture_findings_section(
            report.engagement_id,
            _pcap_store_from_context(ctx),
            _pcap_analysis_store_from_context(ctx),
        )
        artifact = render_report_artifact(
            report,
            engagement,
            _events_in_range(events, report.since, report.until),
            alerts,
            audit_logs,
            capture_findings,
        )
        updated = report.model_copy(
            update={
                "status": ReportStatus.READY,
                "content_b64": base64.b64encode(artifact.content).decode(),
                "content_type": artifact.content_type,
                "filename": artifact.filename,
                "error": None,
                "updated_at": datetime.now(tz=UTC),
            }
        )
    except Exception as exc:
        updated = report.model_copy(
            update={
                "status": ReportStatus.FAILED,
                "error": str(exc) or "report_generation_failed",
                "updated_at": datetime.now(tz=UTC),
            }
        )
    await store.update_report(updated)
    return updated.status == ReportStatus.READY


async def analyze_pcap_capture(
    ctx: dict[str, Any],
    engagement_id: str,
    pcap_id: str,
    actor_id: str,
    analysis_id: str,
) -> bool:
    """Analyze one PCAP using the worker's configured stores and tshark runtime."""

    pcaps = _pcap_store_from_context(ctx)
    analysis_store = _pcap_analysis_store_from_context(ctx)
    settings = _settings_from_context(ctx)
    runtime = _tshark_runtime_from_context(ctx)
    store = _store_from_context(ctx)
    oui = _oui_service_from_context(ctx)
    if pcaps is None or analysis_store is None or settings is None or runtime is None:
        return False
    pcap = await pcaps.get_pcap(engagement_id, pcap_id)
    if pcap is None:
        return False
    try:
        await PcapAnalyzer(pcaps, analysis_store, runtime, settings, store, oui).analyze(
            pcap,
            actor_id=actor_id,
            analysis_id=analysis_id,
        )
        return True
    except Exception as exc:
        await pcaps.update_pcap_status(engagement_id, pcap_id, PcapStatus.FAILED)
        await _record_failed_analysis(
            analysis_store,
            engagement_id,
            pcap_id,
            actor_id,
            analysis_id,
            exc,
        )
        return False


def _store_from_context(ctx: dict[str, Any]) -> Store | None:
    store = ctx.get("store")
    if store is None:
        return None
    return cast(Store, store)


def _pcap_store_from_context(ctx: dict[str, Any]) -> PcapStore | None:
    pcaps = ctx.get("pcap_store")
    if pcaps is None:
        return None
    return cast(PcapStore, pcaps)


def _pcap_analysis_store_from_context(ctx: dict[str, Any]) -> PcapAnalysisStore | None:
    analysis_store = ctx.get("pcap_analysis_store")
    if analysis_store is None:
        return None
    return cast(PcapAnalysisStore, analysis_store)


def _settings_from_context(ctx: dict[str, Any]) -> Settings | None:
    settings = ctx.get("settings")
    if settings is None:
        return None
    return cast(Settings, settings)


def _tshark_runtime_from_context(ctx: dict[str, Any]) -> TsharkRunner | None:
    runtime = ctx.get("tshark_runtime")
    if runtime is None:
        return None
    return cast(TsharkRunner, runtime)


def _oui_service_from_context(ctx: dict[str, Any]) -> OuiService | None:
    oui = ctx.get("oui_service")
    if oui is None:
        return None
    return cast(OuiService, oui)


def _llm_service_from_context(ctx: dict[str, Any]) -> LlmInsightService | None:
    store = _store_from_context(ctx)
    settings = _settings_from_context(ctx)
    client = ctx.get("llm_client")
    cache = ctx.get("insight_cache")
    ledger = ctx.get("usage_ledger")
    redactor = ctx.get("prompt_redactor")
    templates = ctx.get("prompt_templates")
    if not _has_llm_context(store, settings, client, cache, ledger, redactor, templates):
        return None
    return LlmInsightService(
        client=cast(LlmClient, client),
        cache=cast(InsightCache, cache),
        ledger=cast(UsageLedger, ledger),
        redactor=cast(PromptRedactor, redactor),
        templates=cast(PromptTemplates, templates),
        audit=AuditLogger(cast(Store, store)),
        settings=cast(Settings, settings),
        store=cast(Store, store),
    )


def _has_llm_context(
    store: Store | None,
    settings: Settings | None,
    client: object,
    cache: object,
    ledger: object,
    redactor: object,
    templates: object,
) -> bool:
    return all(
        item is not None for item in (store, settings, client, cache, ledger, redactor, templates)
    )


def _events_in_range(events: list[Event], since: datetime, until: datetime) -> list[Event]:
    return [event for event in events if since <= event.occurred_at <= until]


async def _capture_findings_section(
    engagement_id: str,
    pcaps: PcapStore | None,
    analysis_store: PcapAnalysisStore | None,
) -> CaptureFindingsSection | None:
    if pcaps is None or analysis_store is None:
        return None
    pcap_items, _ = await pcaps.list_pcaps(engagement_id, 100, 0)
    analyzed = [pcap for pcap in pcap_items if pcap.status == PcapStatus.ANALYZED]
    findings: list[Finding] = []
    for pcap in analyzed:
        page, _ = await analysis_store.list_findings(engagement_id, pcap.id, 500, 0)
        findings.extend(page)
    return build_capture_findings_section(pcap_items, findings)


async def _record_failed_analysis(
    analysis_store: PcapAnalysisStore,
    engagement_id: str,
    pcap_id: str,
    actor_id: str,
    analysis_id: str,
    exc: Exception,
) -> None:
    existing = await analysis_store.latest_run(engagement_id, pcap_id)
    if existing is not None and existing.id == analysis_id:
        updated = existing.model_copy(
            update={
                "status": AnalysisRunStatus.FAILED,
                "error": str(exc)[:200] or "analysis_failed",
                "finished_at": datetime.now(tz=UTC),
            }
        )
        await analysis_store.update_run(updated)
        return
    await analysis_store.create_run(
        AnalysisRun(
            id=analysis_id,
            pcap_id=pcap_id,
            engagement_id=engagement_id,
            actor_id=actor_id,
            status=AnalysisRunStatus.FAILED,
            error=str(exc)[:200] or "analysis_failed",
            started_at=datetime.now(tz=UTC),
            finished_at=datetime.now(tz=UTC),
        )
    )
