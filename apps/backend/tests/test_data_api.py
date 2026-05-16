# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for device, event, acknowledgement, and audit APIs."""

from __future__ import annotations

import pytest
from conftest import BackendClient
from helpers import create_verified_admin

from cheeky_pony_shared import AccessPoint, Client, Event, EventKind

pytestmark = pytest.mark.asyncio


async def test_device_and_event_lists_are_authenticated(backend_client: BackendClient) -> None:
    """Authenticated users can list normalized telemetry."""

    await create_verified_admin(backend_client)
    await backend_client.store.upsert_access_point(
        AccessPoint(bssid="AA:BB:CC:DD:EE:FF", ssid="Lab", channel=6)
    )
    await backend_client.store.upsert_client(Client(mac="11:22:33:44:55:66"))
    await backend_client.store.insert_event(
        Event(
            id="evt-1",
            sensor_id="pi-1",
            kind=EventKind.ACCESS_POINT_SEEN,
            payload={"bssid": "AA:BB:CC:DD:EE:FF"},
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

    ap_detail = await backend_client.client.get("/api/v1/access_points/AA:BB:CC:DD:EE:FF")
    client_detail = await backend_client.client.get("/api/v1/devices/11:22:33:44:55:66")
    event_detail = await backend_client.client.get("/api/v1/events/evt-1")
    missing_ap = await backend_client.client.get("/api/v1/access_points/00:00:00:00:00:00")

    assert ap_detail.status_code == 200
    assert client_detail.status_code == 200
    assert event_detail.status_code == 200
    assert missing_ap.status_code == 404


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


async def test_audit_has_no_delete_route(backend_client: BackendClient) -> None:
    """Audit logs can be listed but not deleted over the API."""

    csrf = await create_verified_admin(backend_client)
    response = await backend_client.client.delete("/api/v1/audit", headers={"x-csrf-token": csrf})

    assert response.status_code in {404, 405}
