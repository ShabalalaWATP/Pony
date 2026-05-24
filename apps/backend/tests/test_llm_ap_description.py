# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for AP-description LLM insights."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from conftest import BackendClient
from helpers import create_verified_admin

from cheeky_pony_backend.dependencies import get_oui_service
from cheeky_pony_backend.llm.insights.ap_description import (
    build_ap_description_context,
    normalize_bssid,
)
from cheeky_pony_shared import AccessPoint, Client, Event, EventKind, SignalSample

pytestmark = pytest.mark.asyncio

_BSSID = "38:C9:86:00:00:01"
_CLIENT_MAC = "B8:27:EB:00:00:02"


async def test_ap_description_context_excludes_raw_identifiers(
    backend_client: BackendClient,
) -> None:
    """Prompt context summarizes AP/client facts without raw MAC-like values."""

    await _seed_ap_inputs(backend_client)

    context = await build_ap_description_context(
        backend_client.store,
        _BSSID,
        oui=get_oui_service(),
        label_confidence_threshold=backend_client.settings.label_confidence_threshold,
    )

    assert context is not None
    payload = context.model_dump_json()
    assert "38:C9:86" not in payload
    assert "B8:27:EB" not in payload
    assert "Cafe WiFi" not in payload
    assert context.access_point.label == "corporate"
    assert context.associated_clients.count == 1
    assert context.signal.sample_count == 3


async def test_normalize_bssid_accepts_common_formats() -> None:
    """BSSID normalization keeps cache keys stable across route formats."""

    assert normalize_bssid("38:c9:86:00:00:01") == _BSSID
    assert normalize_bssid("38-c9-86-00-00-01") == _BSSID
    assert normalize_bssid("38c986000001") == _BSSID
    assert normalize_bssid("not-a-bssid") is None


async def test_ap_description_context_handles_hidden_unknown_ap(
    backend_client: BackendClient,
) -> None:
    """Hidden APs with sparse metadata still produce bounded prompt context."""

    bssid = "02:00:00:00:00:01"
    await backend_client.store.upsert_access_point(AccessPoint(bssid=bssid, ssid=None))
    await backend_client.store.upsert_client(
        Client(mac="02:00:00:00:00:02", associated_bssid=bssid, probes=[])
    )
    for index in range(11):
        await backend_client.store.insert_event(_deauth_event(index, bssid))

    context = await build_ap_description_context(
        backend_client.store,
        bssid,
        oui=get_oui_service(),
        label_confidence_threshold=backend_client.settings.label_confidence_threshold,
    )
    missing = await build_ap_description_context(
        backend_client.store,
        "invalid",
        oui=get_oui_service(),
        label_confidence_threshold=backend_client.settings.label_confidence_threshold,
    )

    assert context is not None
    assert missing is None
    assert context.access_point.hidden is True
    assert context.signal.sample_count == 0
    assert {item.kind for item in context.associated_clients.vendor_mix} == {"unknown"}
    assert any("hidden_ssid" in reason for reason in context.access_point.anomaly_reasons)
    assert any("recent_deauth_burst" in reason for reason in context.access_point.anomaly_reasons)


async def test_ap_description_route_generates_then_uses_cache(
    backend_client: BackendClient,
) -> None:
    """GET AP insight generates once and serves normalized cache hits."""

    await create_verified_admin(backend_client)
    backend_client.settings.llm_enabled = True
    await _seed_ap_inputs(backend_client)

    first = await backend_client.client.get("/api/v1/insights/ap/38:c9:86:00:00:01")
    second = await backend_client.client.get("/api/v1/insights/ap/38c986000001")

    assert first.status_code == 200
    assert first.json()["kind"] == "ap_description"
    assert first.json()["entity_id"] == _BSSID
    assert first.json()["cached"] is False
    assert second.status_code == 200
    assert second.json()["cached"] is True
    assert backend_client.llm_client is not None
    assert len(backend_client.llm_client.calls) == 1
    prompt = backend_client.llm_client.calls[0][0].content
    assert "38:C9:86" not in prompt
    assert _CLIENT_MAC not in prompt
    assert "Cafe WiFi" not in prompt


async def test_ap_description_route_returns_404_for_unknown_bssid(
    backend_client: BackendClient,
) -> None:
    """Unknown APs are not generated and return 404."""

    await create_verified_admin(backend_client)
    backend_client.settings.llm_enabled = True

    response = await backend_client.client.get("/api/v1/insights/ap/38:c9:86:00:00:01")

    assert response.status_code == 404
    assert backend_client.store.audit_logs[-1].action == "llm.insight.ap_description"
    assert backend_client.store.audit_logs[-1].parameters["outcome"] == "refused"


async def _seed_ap_inputs(backend_client: BackendClient) -> None:
    started = datetime(2026, 5, 24, 9, 0, tzinfo=UTC)
    await backend_client.store.upsert_access_point(
        AccessPoint(
            bssid=_BSSID,
            ssid="AcmeCorp-Guest",
            channel=6,
            band="2.4GHz",
            encryption=["WPA2-Enterprise"],
            flags=["pmf"],
            first_seen=started,
            last_seen=started + timedelta(minutes=2),
            signal_history=[
                SignalSample(seen_at=started, rssi_dbm=-60),
                SignalSample(seen_at=started + timedelta(minutes=1), rssi_dbm=-55),
                SignalSample(seen_at=started + timedelta(minutes=2), rssi_dbm=-58),
            ],
        )
    )
    await backend_client.store.upsert_client(
        Client(
            mac=_CLIENT_MAC,
            associated_bssid=_BSSID,
            probes=["Cafe WiFi", "HomeNet", "Train_WiFi"],
            first_seen=started,
            last_seen=started + timedelta(minutes=2),
        )
    )


def _deauth_event(index: int, bssid: str) -> Event:
    return Event(
        id=f"evt-{index}",
        sensor_id="sensor-1",
        kind=EventKind.ACCESS_POINT_SEEN,
        payload={"nested": ["deauth", {"bssid": bssid}]},
        occurred_at=datetime.now(tz=UTC) - timedelta(seconds=index),
    )
