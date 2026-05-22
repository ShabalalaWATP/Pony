# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for AP anomaly API support helpers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from cheeky_pony_backend.api.v1.device_anomaly import (
    associated_client_counts,
    recent_deauth_counts,
    same_ssid_peers,
)
from cheeky_pony_backend.infra.in_memory_store import InMemoryStore
from cheeky_pony_shared import AccessPoint, Client, Event, EventKind

pytestmark = pytest.mark.asyncio


async def test_anomaly_context_counts_clients_and_deauth_payload_shapes() -> None:
    """Batch anomaly context handles nested payloads without per-AP store reads."""

    store = InMemoryStore()
    bssid = "AA:BB:CC:00:00:01"
    now = datetime.now(tz=UTC)
    await store.upsert_client(Client(mac="AA:BB:CC:00:00:10", associated_bssid=bssid))
    await store.insert_event(
        Event(
            id="deauth-list-hit",
            sensor_id="pi-1",
            kind=EventKind.COMMAND_RESULT,
            payload={"items": ["deauth", {"target": [bssid]}]},
            occurred_at=now,
        )
    )
    await store.insert_event(
        Event(
            id="deauth-no-bssid",
            sensor_id="pi-1",
            kind=EventKind.COMMAND_RESULT,
            payload={"type": "deauth"},
            occurred_at=now,
        )
    )
    await store.insert_event(
        Event(
            id="deauth-list-no-bssid",
            sensor_id="pi-1",
            kind=EventKind.COMMAND_RESULT,
            payload={"items": ["deauth", "not-a-bssid"]},
            occurred_at=now,
        )
    )
    await store.insert_event(
        Event(
            id="old-deauth",
            sensor_id="pi-1",
            kind=EventKind.COMMAND_RESULT,
            payload={"type": "deauth", "bssid": bssid},
            occurred_at=now - timedelta(minutes=10),
        )
    )
    await store.insert_event(
        Event(
            id="non-deauth",
            sensor_id="pi-1",
            kind=EventKind.COMMAND_RESULT,
            payload={"type": 1},
            occurred_at=now,
        )
    )

    assert await associated_client_counts(store) == {bssid: 1}
    assert await recent_deauth_counts(store) == {bssid: 1}


async def test_same_ssid_peers_excludes_hidden_and_self() -> None:
    """Same-SSID peer selection keeps exact visible SSID groups only."""

    ap = AccessPoint(bssid="AA:BB:CC:00:00:01", ssid="Corp")
    peer = AccessPoint(bssid="AA:BB:CC:00:00:02", ssid="Corp")
    hidden = AccessPoint(bssid="AA:BB:CC:00:00:03", ssid=None)

    assert same_ssid_peers(ap, [ap, peer, hidden]) == [peer]
    assert same_ssid_peers(hidden, [ap, peer, hidden]) == []
