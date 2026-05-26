# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for sensor registration and revocation routes."""

from __future__ import annotations

import tomllib

import pytest
from conftest import BackendClient
from helpers import create_verified_admin

from cheeky_pony_shared import Sensor

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


async def test_sensor_register_returns_ready_sensor_toml(backend_client: BackendClient) -> None:
    """Registration returns paste-ready sensor config alongside one-time PEMs."""

    csrf = await create_verified_admin(backend_client)
    response = await backend_client.client.post(
        "/api/v1/sensors",
        headers={"x-csrf-token": csrf},
        json={
            "id": "hermes",
            "name": "Hermes",
            "tailnet_ip": "100.116.150.111",
            "capabilities": ["passive_capture"],
            "version": "0.1.0",
            "backend_ws_url": "wss://workstation.example.ts.net/ws/sensor-gateway",
        },
    )

    assert response.status_code == 200
    body = response.json()
    config = tomllib.loads(body["sensor_toml"])
    assert config == {
        "sensor_id": "hermes",
        "sensor_name": "Hermes",
        "backend_ws_url": "wss://workstation.example.ts.net/ws/sensor-gateway",
        "client_cert_path": "/etc/cheeky-pony/client.crt",
        "client_key_path": "/etc/cheeky-pony/client.key",
        "ca_cert_path": "/etc/cheeky-pony/ca.crt",
        "manage_kismet": True,
    }
    stored = await backend_client.store.get_sensor("hermes")
    assert stored is not None
    assert stored.name == "Hermes"


async def test_sensor_register_toml_uses_backend_placeholder_when_missing(
    backend_client: BackendClient,
) -> None:
    """Operators get an editable backend URL placeholder when registration omits it."""

    csrf = await create_verified_admin(backend_client)
    response = await backend_client.client.post(
        "/api/v1/sensors",
        headers={"x-csrf-token": csrf},
        json={
            "id": "pi-placeholder",
            "name": "Pi Placeholder",
            "tailnet_ip": "100.64.0.10",
            "capabilities": ["passive_capture"],
            "version": "0.1.0",
        },
    )

    assert response.status_code == 200
    sensor_toml = response.json()["sensor_toml"]
    config = tomllib.loads(sensor_toml)
    assert "backend_ws_url" not in config
    assert '# backend_ws_url = "wss://<backend-tailnet-host>/ws/sensor-gateway"' in sensor_toml


async def test_sensor_reads_return_geo_fields(backend_client: BackendClient) -> None:
    """Sensor read routes expose stored coordinates without changing gates."""

    await create_verified_admin(backend_client)
    await backend_client.store.create_sensor(
        Sensor(
            id="pi-geo",
            name="Geo Pi",
            tailnet_ip="100.64.0.44",
            version="0.1.0",
            latitude=51.5074,
            longitude=-0.1278,
            location_source="sensor_gps",
        )
    )

    listed = await backend_client.client.get("/api/v1/sensors")
    detail = await backend_client.client.get("/api/v1/sensors/pi-geo")

    assert listed.status_code == 200
    assert detail.status_code == 200
    sensor = listed.json()["items"][0]
    assert sensor["latitude"] == 51.5074
    assert sensor["longitude"] == -0.1278
    assert sensor["location_source"] == "sensor_gps"
    assert detail.json()["latitude"] == 51.5074
