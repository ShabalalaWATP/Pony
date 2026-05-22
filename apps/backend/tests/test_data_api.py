# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for device, event, acknowledgement, and audit APIs."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from conftest import BackendClient
from helpers import create_verified_admin

from cheeky_pony_backend.infra.demo_dataset import build_demo_dataset
from cheeky_pony_shared import AccessPoint, AuditLog, Client, Event, EventKind

pytestmark = pytest.mark.asyncio


async def test_device_and_event_lists_are_authenticated(backend_client: BackendClient) -> None:
    """Authenticated users can list normalized telemetry."""

    await create_verified_admin(backend_client)
    await backend_client.store.upsert_access_point(
        AccessPoint(bssid="38:C9:86:DD:EE:FF", ssid="Lab", channel=6, vendor_oui="Stored AP")
    )
    await backend_client.store.upsert_client(
        Client(mac="B8:27:EB:44:55:66", vendor_oui="Stored client")
    )
    await backend_client.store.insert_event(
        Event(
            id="evt-1",
            sensor_id="pi-1",
            kind=EventKind.ACCESS_POINT_SEEN,
            payload={"bssid": "38:C9:86:DD:EE:FF"},
        )
    )

    aps = await backend_client.client.get("/api/v1/access_points")
    clients = await backend_client.client.get("/api/v1/devices")
    events = await backend_client.client.get("/api/v1/events")

    assert aps.status_code == 200
    assert clients.status_code == 200
    assert events.status_code == 200
    assert aps.json()["total"] == 1
    assert clients.json()["total"] == 1
    assert events.json()["total"] == 1
    assert aps.json()["items"][0]["vendor_resolved"] == "Samsung Electronics Co., Ltd"
    assert aps.json()["items"][0]["vendor_oui"] == "Samsung Electronics Co., Ltd"
    assert clients.json()["items"][0]["vendor_resolved"] == "Raspberry Pi Foundation"
    assert clients.json()["items"][0]["vendor_oui"] == "Raspberry Pi Foundation"
    assert aps.json()["items"][0]["label"] == "unknown"
    assert 0.0 <= aps.json()["items"][0]["label_confidence"] <= 1.0
    assert clients.json()["items"][0]["label"] == "iot"
    assert 0.0 <= clients.json()["items"][0]["label_confidence"] <= 1.0

    ap_detail = await backend_client.client.get("/api/v1/access_points/38:C9:86:DD:EE:FF")
    client_detail = await backend_client.client.get("/api/v1/devices/B8:27:EB:44:55:66")
    event_detail = await backend_client.client.get("/api/v1/events/evt-1")
    missing_ap = await backend_client.client.get("/api/v1/access_points/00:00:00:00:00:00")

    assert ap_detail.status_code == 200
    assert client_detail.status_code == 200
    assert ap_detail.json()["vendor_resolved"] == "Samsung Electronics Co., Ltd"
    assert client_detail.json()["vendor_resolved"] == "Raspberry Pi Foundation"
    assert "label" in ap_detail.json()
    assert "label_confidence" in client_detail.json()
    assert event_detail.status_code == 200
    assert missing_ap.status_code == 404


async def test_unknown_oui_keeps_stored_vendor_without_error(
    backend_client: BackendClient,
) -> None:
    """Unknown MAC prefixes do not break response serialization."""

    await create_verified_admin(backend_client)
    await backend_client.store.upsert_access_point(
        AccessPoint(bssid="AA:BB:CC:DD:EE:FF", ssid="Unknown", vendor_oui="Kismet")
    )
    await backend_client.store.upsert_client(Client(mac="AA:BB:CC:44:55:66", vendor_oui="Kismet"))

    aps = await backend_client.client.get("/api/v1/access_points")
    clients = await backend_client.client.get("/api/v1/devices")

    assert aps.status_code == 200
    assert clients.status_code == 200
    assert aps.json()["items"][0]["vendor_resolved"] is None
    assert aps.json()["items"][0]["vendor_oui"] == "Kismet"
    assert clients.json()["items"][0]["vendor_resolved"] is None
    assert clients.json()["items"][0]["vendor_oui"] == "Kismet"


async def test_oui_lookup_route_returns_public_vendor_data(
    backend_client: BackendClient,
) -> None:
    """The public OUI route resolves known prefixes and rejects bad input."""

    known = await backend_client.client.get("/api/v1/oui/38c986")
    unknown = await backend_client.client.get("/api/v1/oui/aabbcc")
    malformed = await backend_client.client.get("/api/v1/oui/not-a-prefix")

    assert known.status_code == 200
    assert known.json() == {
        "prefix": "38:c9:86",
        "short_vendor": "Samsung",
        "long_vendor": "Samsung Electronics Co., Ltd",
    }
    assert unknown.status_code == 404
    assert malformed.status_code == 422


async def test_access_point_clients_are_paginated_and_sorted(
    backend_client: BackendClient,
) -> None:
    """Access point detail clients are filtered by BSSID and newest first."""

    await create_verified_admin(backend_client)
    bssid = "AA:BB:CC:DD:EE:FF"
    await backend_client.store.upsert_access_point(AccessPoint(bssid=bssid, ssid="Lab"))
    await backend_client.store.upsert_client(
        Client(
            mac="11:22:33:44:55:66",
            associated_bssid=bssid,
            last_seen=datetime(2026, 1, 1, tzinfo=UTC),
        )
    )
    await backend_client.store.upsert_client(
        Client(
            mac="22:33:44:55:66:77",
            associated_bssid=bssid,
            last_seen=datetime(2026, 1, 2, tzinfo=UTC),
        )
    )
    await backend_client.store.upsert_client(Client(mac="33:44:55:66:77:88"))

    response = await backend_client.client.get(f"/api/v1/access_points/{bssid}/clients")

    assert response.status_code == 200
    assert response.json()["total"] == 2
    assert [item["mac"] for item in response.json()["items"]] == [
        "22:33:44:55:66:77",
        "11:22:33:44:55:66",
    ]


async def test_access_points_api_returns_seeded_demo_geo(
    backend_client: BackendClient,
) -> None:
    """Synthetic AP geo fields are visible through the normal read path."""

    await create_verified_admin(backend_client)
    dataset = build_demo_dataset(datetime(2026, 5, 18, 12, tzinfo=UTC), with_active=False)
    for access_point in dataset.access_points:
        await backend_client.store.upsert_access_point(access_point)

    response = await backend_client.client.get("/api/v1/access_points?limit=500")
    items = response.json()["items"]
    geolocated = [item for item in items if item["latitude"] is not None]
    ungeolocated = [item for item in items if item["latitude"] is None]

    assert response.status_code == 200
    assert response.json()["total"] == 50
    assert len(geolocated) >= 45
    assert len(ungeolocated) >= 1
    assert all(item["longitude"] is not None for item in geolocated)
    assert all(item["location_source"] == "sensor_gps" for item in geolocated)


async def test_authorized_acknowledgement_requires_exact_statement(
    backend_client: BackendClient,
) -> None:
    """The authorized-operator acknowledgement requires the typed legal phrase."""

    csrf = await create_verified_admin(backend_client)

    denied = await backend_client.client.post(
        "/api/v1/system/acknowledgements",
        json={"statement": "I agree"},
        headers={"x-csrf-token": csrf},
    )
    accepted = await backend_client.client.post(
        "/api/v1/system/acknowledgements",
        json={
            "statement": "I am authorized to test the listed wireless targets in this engagement."
        },
        headers={"x-csrf-token": csrf},
    )

    assert denied.status_code == 422
    assert accepted.status_code == 200
    assert accepted.json()["kind"] == "authorized_operator"

    audit = await backend_client.client.get("/api/v1/audit")
    assert audit.status_code == 200
    assert audit.json()["total"] >= 1


async def test_authorized_acknowledgement_forbids_extra_fields(
    backend_client: BackendClient,
) -> None:
    """System write models reject undeclared fields."""

    csrf = await create_verified_admin(backend_client)

    response = await backend_client.client.post(
        "/api/v1/system/acknowledgements",
        json={
            "statement": "I am authorized to test the listed wireless targets in this engagement.",
            "admin": True,
        },
        headers={"x-csrf-token": csrf},
    )

    assert response.status_code == 422
    assert backend_client.store.audit_logs[-1].action == "system.acknowledgement"
    assert backend_client.store.audit_logs[-1].outcome == "denied:invalid_payload"


async def test_audit_has_no_delete_route(backend_client: BackendClient) -> None:
    """Audit logs can be listed but not deleted over the API."""

    csrf = await create_verified_admin(backend_client)
    response = await backend_client.client.delete("/api/v1/audit", headers={"x-csrf-token": csrf})

    assert response.status_code in {404, 405}


async def test_demo_status_reports_synthetic_count(backend_client: BackendClient) -> None:
    """Demo status exposes synthetic record count for the frontend banner."""

    await create_verified_admin(backend_client)
    seeded_at = datetime(2026, 1, 2, tzinfo=UTC)
    await backend_client.store.upsert_access_point(
        AccessPoint(bssid="02:00:A0:00:00:01", ssid="synth-ap-00", synthetic=True)
    )
    await backend_client.store.append_audit(
        AuditLog(
            id="audit-demo-seed",
            actor_id="system:seed",
            action="demo.seed.run",
            target={},
            parameters={},
            outcome="ok",
            occurred_at=seeded_at,
        )
    )

    response = await backend_client.client.get("/api/v1/system/demo-status")

    assert response.status_code == 200
    assert response.json()["synthetic_records"] == 1
    returned_at = datetime.fromisoformat(response.json()["last_seeded_at"].replace("Z", "+00:00"))
    assert returned_at == seeded_at
