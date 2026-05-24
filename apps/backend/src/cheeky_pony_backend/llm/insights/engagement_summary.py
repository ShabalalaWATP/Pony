# SPDX-License-Identifier: AGPL-3.0-only
"""Engagement-summary insight prompt builder and response schema."""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field

from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.infra.pcap_analysis_store import PcapAnalysisStore
from cheeky_pony_backend.infra.pcap_store import PcapStore
from cheeky_pony_backend.llm.types import InsightConfidence
from cheeky_pony_shared import Alert, AlertSeverity, Engagement, Event

_EVENT_LIMIT = 5_000
_ALERT_LIMIT = 50
_PCAP_LIMIT = 100
_TOP_ALERT_LIMIT = 5
_SEVERITY_RANK = {
    AlertSeverity.CRITICAL: 0,
    AlertSeverity.HIGH: 1,
    AlertSeverity.MEDIUM: 2,
    AlertSeverity.LOW: 3,
    AlertSeverity.INFO: 4,
}


class EngagementSummaryResponse(BaseModel):
    """Validated model response for engagement-summary insights."""

    model_config = ConfigDict(extra="forbid")

    summary: str = Field(min_length=1, max_length=600)
    bullet_points: list[str] = Field(default_factory=list, max_length=5)
    confidence: InsightConfidence


class CountItem(BaseModel):
    """Prompt-safe count bucket."""

    model_config = ConfigDict(extra="forbid")

    kind: str = Field(min_length=1, max_length=128)
    count: int = Field(ge=0)


class EngagementSummaryEngagement(BaseModel):
    """Prompt-safe engagement metadata."""

    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    scope_rule_count: int
    started_at: datetime
    ended_at: datetime | None
    allow_list_count: int
    synthetic: bool


class EngagementSummaryAlert(BaseModel):
    """Prompt-safe alert summary."""

    model_config = ConfigDict(extra="forbid")

    id: str
    rule_id: str
    severity: str
    related_entities_count: int
    acknowledged: bool
    synthetic: bool


class EngagementSummaryPromptContext(BaseModel):
    """Structured prompt context for one engagement."""

    model_config = ConfigDict(extra="forbid")

    engagement: EngagementSummaryEngagement
    event_counts: list[CountItem]
    top_alerts: list[EngagementSummaryAlert]
    pcap_finding_counts: list[CountItem]


async def build_engagement_summary_context(
    store: Store,
    engagement_id: str,
    *,
    pcap_store: PcapStore | None,
    analysis_store: PcapAnalysisStore | None,
) -> EngagementSummaryPromptContext | None:
    """Build deterministic structured context for one engagement."""

    engagement = await store.get_engagement(engagement_id)
    if engagement is None:
        return None
    return EngagementSummaryPromptContext(
        engagement=await _engagement_context(store, engagement),
        event_counts=await _event_counts(store, engagement),
        top_alerts=await _top_alerts(store),
        pcap_finding_counts=await _pcap_finding_counts(engagement_id, pcap_store, analysis_store),
    )


async def _engagement_context(
    store: Store,
    engagement: Engagement,
) -> EngagementSummaryEngagement:
    _, allow_list_count = await store.list_allowed_targets(engagement.id, 1, 0)
    return EngagementSummaryEngagement(
        id=engagement.id,
        name=engagement.name,
        scope_rule_count=len(engagement.scope_rules),
        started_at=engagement.started_at,
        ended_at=engagement.ended_at,
        allow_list_count=allow_list_count,
        synthetic=engagement.synthetic,
    )


async def _event_counts(store: Store, engagement: Engagement) -> list[CountItem]:
    events, _ = await store.list_events(_EVENT_LIMIT, 0)
    windowed = [event for event in events if _in_engagement_window(event, engagement)]
    return _count_items(event.kind.value for event in windowed)


async def _top_alerts(store: Store) -> list[EngagementSummaryAlert]:
    alerts, _ = await store.list_alerts(_ALERT_LIMIT, 0, None, None)
    ranked = sorted(alerts, key=_alert_sort_key)[:_TOP_ALERT_LIMIT]
    return [_alert_context(alert) for alert in ranked]


async def _pcap_finding_counts(
    engagement_id: str,
    pcap_store: PcapStore | None,
    analysis_store: PcapAnalysisStore | None,
) -> list[CountItem]:
    if pcap_store is None or analysis_store is None:
        return []
    pcaps, _ = await pcap_store.list_pcaps(engagement_id, _PCAP_LIMIT, 0)
    counter: Counter[str] = Counter()
    for pcap in pcaps:
        for kind, count in (await analysis_store.finding_counts(engagement_id, pcap.id)).items():
            counter[kind.value] += count
    return _count_items(counter.elements())


def _in_engagement_window(event: Event, engagement: Engagement) -> bool:
    until = engagement.ended_at or datetime.now(tz=UTC)
    return engagement.started_at <= event.occurred_at <= until


def _count_items(values: Iterable[object]) -> list[CountItem]:
    counter = Counter(str(value) for value in values)
    return [CountItem(kind=kind, count=counter[kind]) for kind in sorted(counter)]


def _alert_context(alert: Alert) -> EngagementSummaryAlert:
    return EngagementSummaryAlert(
        id=alert.id,
        rule_id=alert.rule_id,
        severity=alert.severity.value,
        related_entities_count=len(alert.related_entities),
        acknowledged=alert.acked_at is not None,
        synthetic=alert.synthetic,
    )


def _alert_sort_key(alert: Alert) -> tuple[int, str]:
    return (_SEVERITY_RANK[alert.severity], alert.id)
