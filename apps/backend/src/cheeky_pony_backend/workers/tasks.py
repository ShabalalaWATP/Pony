# SPDX-License-Identifier: AGPL-3.0-only
"""arq task entrypoints for backend background work."""

from __future__ import annotations

from typing import Any


async def batch_insert_events(ctx: dict[str, Any], events: list[dict[str, Any]]) -> int:
    """Insert a batch of event payloads.

    Args:
        ctx: arq context.
        events: Event dictionaries.

    Returns:
        Number of events accepted for insertion.
    """

    return len(events)


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

    _ = ctx, event
    return []
