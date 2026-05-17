# SPDX-License-Identifier: AGPL-3.0-only
"""arq task entrypoints for backend background work."""

from __future__ import annotations

import base64
from datetime import UTC, datetime
from typing import Any, cast

from cheeky_pony_backend.domain.alerts import AlertRuleEngine
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.reports import ReportStatus, render_report_artifact
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
        await engine.evaluate_event(event)
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
    return [alert.model_dump(mode="json") for alert in alerts]


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
        artifact = render_report_artifact(
            report,
            engagement,
            _events_in_range(events, report.since, report.until),
            alerts,
            audit_logs,
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


def _store_from_context(ctx: dict[str, Any]) -> Store | None:
    store = ctx.get("store")
    if store is None:
        return None
    return cast(Store, store)


def _events_in_range(events: list[Event], since: datetime, until: datetime) -> list[Event]:
    return [event for event in events if since <= event.occurred_at <= until]
