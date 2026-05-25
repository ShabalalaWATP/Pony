# SPDX-License-Identifier: AGPL-3.0-only
"""Alert-context insight prompt builder and response schema."""

from __future__ import annotations

from collections.abc import Mapping

from pydantic import BaseModel, ConfigDict, Field

from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.llm.types import InsightBullet, InsightConfidence
from cheeky_pony_shared import Alert, AlertRule


class AlertContextResponse(BaseModel):
    """Validated model response for alert-context insights."""

    model_config = ConfigDict(extra="forbid")

    summary: str = Field(min_length=1, max_length=600)
    bullet_points: list[InsightBullet] = Field(default_factory=list, max_length=5)
    confidence: InsightConfidence


class AlertContextAlert(BaseModel):
    """Prompt-safe alert facts."""

    model_config = ConfigDict(extra="forbid")

    id: str
    rule_id: str
    severity: str
    related_entities: list[str]
    acknowledged: bool
    synthetic: bool


class AlertContextRule(BaseModel):
    """Prompt-safe rule facts."""

    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    description: str | None
    severity: str
    enabled: bool
    predicate_summary: dict[str, object]
    synthetic: bool


class AlertContextPromptContext(BaseModel):
    """Structured prompt context for one alert."""

    model_config = ConfigDict(extra="forbid")

    alert: AlertContextAlert
    rule: AlertContextRule | None


async def build_alert_context(store: Store, alert_id: str) -> AlertContextPromptContext | None:
    """Build deterministic structured context for one alert."""

    alert = await store.get_alert(alert_id)
    if alert is None:
        return None
    rule = await store.get_alert_rule(alert.rule_id)
    return AlertContextPromptContext(
        alert=_alert_context(alert),
        rule=None if rule is None else _rule_context(rule),
    )


def _alert_context(alert: Alert) -> AlertContextAlert:
    return AlertContextAlert(
        id=alert.id,
        rule_id=alert.rule_id,
        severity=alert.severity.value,
        related_entities=alert.related_entities,
        acknowledged=alert.acked_at is not None,
        synthetic=alert.synthetic,
    )


def _rule_context(rule: AlertRule) -> AlertContextRule:
    return AlertContextRule(
        id=rule.id,
        name=rule.name,
        description=rule.description,
        severity=rule.severity.value,
        enabled=rule.enabled,
        predicate_summary=_predicate_summary(rule.predicate),
        synthetic=rule.synthetic,
    )


def _predicate_summary(predicate: Mapping[str, object]) -> dict[str, object]:
    match_fields: list[str] = []
    watch_count = 0
    match = predicate.get("match")
    if isinstance(match, dict):
        match_fields = sorted(str(key) for key in match)
    watch = predicate.get("watch")
    if isinstance(watch, list):
        watch_count = len(watch)
    return {
        "event_kind": predicate.get("event_kind"),
        "match_fields": match_fields,
        "watch_count": watch_count,
    }
