# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for sensor registration and revocation routes."""

from __future__ import annotations

import pytest
from conftest import BackendClient
from helpers import create_verified_admin

pytestmark = pytest.mark.asyncio


async def test_sensor_register_and_revoke_are_audited(backend_client: BackendClient) -> None:
    """Sensor admin mutations record success and refusal audit rows."""

    csrf = await create_verified_admin(backend_client)
    payload = {
        "id": "pi-1",
        "name": "Pi 1",
        "tailnet_ip": "100.64.0.10",
        "capabilities": ["passive_capture"],
        "version": "0.1.0",
    }

    created = await backend_client.client.post(
        "/api/v1/sensors",
        headers={"x-csrf-token": csrf},
        json=payload,
    )
    duplicate = await backend_client.client.post(
        "/api/v1/sensors",
        headers={"x-csrf-token": csrf},
        json=payload,
    )
    revoked = await backend_client.client.post(
        "/api/v1/sensors/pi-1/revoke",
        headers={"x-csrf-token": csrf},
    )
    missing = await backend_client.client.post(
        "/api/v1/sensors/missing/revoke",
        headers={"x-csrf-token": csrf},
    )

    assert created.status_code == 200
    assert duplicate.status_code == 409
    assert revoked.status_code == 204
    assert missing.status_code == 404
    assert [(log.action, log.outcome) for log in backend_client.store.audit_logs[-4:]] == [
        ("sensor.register", "ok"),
        ("sensor.register", "denied:sensor_exists"),
        ("sensor.revoke", "ok"),
        ("sensor.revoke", "denied:not_found"),
    ]
    assert "BEGIN CERTIFICATE" not in backend_client.store.audit_logs[-4].model_dump_json()
