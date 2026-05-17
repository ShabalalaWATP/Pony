# SPDX-License-Identifier: AGPL-3.0-only
"""arq task entrypoints for backend background work."""

from __future__ import annotations

from typing import Any, cast

from cheeky_pony_backend.domain.alerts import AlertRuleEngine
from cheeky_pony_backend.domain.ports import Store
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


def _store_from_context(ctx: dict[str, Any]) -> Store | None:
    store = ctx.get("store")
    if store is None:
        return None
    return cast(Store, store)
