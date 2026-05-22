# SPDX-License-Identifier: AGPL-3.0-only
"""Access point anomaly serialization support."""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from cheeky_pony_backend.domain.oui_lookup import OuiService
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_shared import AccessPoint, Client, Event

BSSID_PATTERN = re.compile(r"^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$")
RECENT_DEAUTH_WINDOW = timedelta(minutes=5)
ANOMALY_EVENT_SCAN_LIMIT = 500
ANOMALY_CLIENT_SCAN_LIMIT = 500
ANOMALY_AP_SCAN_LIMIT = 500


@dataclass(frozen=True)
class AccessPointScoringContext:
    """Batch data used while serializing access point anomaly fields."""

    access_points: list[AccessPoint]
    associated_clients: dict[str, int]
    recent_deauths: dict[str, int]


async def build_access_point_scoring_context(
    store: Store,
    oui: OuiService,
) -> AccessPointScoringContext:
    """Load bounded context needed for AP anomaly scoring.

    Args:
        store: Application store.
        oui: OUI lookup service.

    Returns:
        Access point scoring context for one response batch.
    """

    access_points, _ = await store.list_access_points(ANOMALY_AP_SCAN_LIMIT, 0)
    return AccessPointScoringContext(
        access_points=[resolve_access_point_vendor(ap, oui) for ap in access_points],
        associated_clients=await associated_client_counts(store),
        recent_deauths=await recent_deauth_counts(store),
    )


async def associated_client_counts(store: Store) -> dict[str, int]:
    """Count currently associated clients by BSSID.

    Args:
        store: Application store.

    Returns:
        Associated client counts keyed by normalized BSSID.
    """

    clients, _ = await store.list_clients(ANOMALY_CLIENT_SCAN_LIMIT, 0)
    return _associated_client_counts(clients)


async def recent_deauth_counts(store: Store) -> dict[str, int]:
    """Count recent deauthentication events by BSSID.

    Args:
        store: Application store.

    Returns:
        Recent deauthentication counts keyed by normalized BSSID.
    """

    events, _ = await store.list_events(ANOMALY_EVENT_SCAN_LIMIT, 0)
    cutoff = datetime.now(tz=UTC) - RECENT_DEAUTH_WINDOW
    return _recent_deauth_counts(events, cutoff)


def same_ssid_peers(ap: AccessPoint, access_points: list[AccessPoint]) -> list[AccessPoint]:
    """Return other APs from the same exact SSID group.

    Args:
        ap: Access point being scored.
        access_points: Candidate peer access points.

    Returns:
        Access points with the same non-hidden SSID, excluding the AP itself.
    """

    if ap.ssid is None:
        return []
    return [
        peer
        for peer in access_points
        if peer.bssid.upper() != ap.bssid.upper() and peer.ssid == ap.ssid
    ]


def resolve_access_point_vendor(ap: AccessPoint, oui: OuiService) -> AccessPoint:
    """Return an AP copy with a resolved OUI vendor when one is known.

    Args:
        ap: Stored access point record.
        oui: OUI lookup service.

    Returns:
        Access point with response-time vendor enrichment.
    """

    vendor_name = resolved_vendor_name(ap.bssid, oui)
    if vendor_name is None:
        return ap
    return ap.model_copy(update={"vendor_oui": vendor_name})


def resolved_vendor_name(mac: str, oui: OuiService) -> str | None:
    """Resolve a MAC address prefix to the long OUI vendor name.

    Args:
        mac: MAC address or BSSID.
        oui: OUI lookup service.

    Returns:
        Long vendor name when the prefix exists in the embedded table.
    """

    vendor = oui.lookup(mac)
    return None if vendor is None else vendor.long_vendor


def _associated_client_counts(clients: list[Client]) -> dict[str, int]:
    counts: Counter[str] = Counter()
    for client in clients:
        if client.associated_bssid is not None:
            counts[client.associated_bssid.upper()] += 1
    return dict(counts)


def _recent_deauth_counts(events: list[Event], cutoff: datetime) -> dict[str, int]:
    counts: Counter[str] = Counter()
    for event in events:
        bssid = _event_deauth_bssid(event, cutoff)
        if bssid is not None:
            counts[bssid.upper()] += 1
    return dict(counts)


def _event_deauth_bssid(event: Event, cutoff: datetime) -> str | None:
    if event.occurred_at < cutoff or not _payload_mentions_deauth(event.payload):
        return None
    return _payload_bssid(event.payload)


def _payload_mentions_deauth(value: object) -> bool:
    if isinstance(value, str):
        return "deauth" in value.lower()
    if isinstance(value, dict):
        return any(_payload_mentions_deauth(item) for item in value.values())
    if isinstance(value, list):
        return any(_payload_mentions_deauth(item) for item in value)
    return False


def _payload_bssid(value: object) -> str | None:
    if isinstance(value, str) and BSSID_PATTERN.fullmatch(value):
        return value
    if isinstance(value, dict):
        return _payload_mapping_bssid(value)
    if isinstance(value, list):
        return _payload_list_bssid(value)
    return None


def _payload_mapping_bssid(value: dict[object, object]) -> str | None:
    for item in value.values():
        bssid = _payload_bssid(item)
        if bssid is not None:
            return bssid
    return None


def _payload_list_bssid(value: list[object]) -> str | None:
    for item in value:
        bssid = _payload_bssid(item)
        if bssid is not None:
            return bssid
    return None
