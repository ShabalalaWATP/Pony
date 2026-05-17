# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for sensor lifecycle command API routes."""

from __future__ import annotations

import pytest
from conftest import BackendClient
from helpers import create_verified_admin

from cheeky_pony_shared import Sensor, SensorCapability

pytestmark = pytest.mark.asyncio


async def test_sensor_lifecycle_commands_are_accepted_and_audited(
    backend_client: BackendClient,
) -> None:
    """Verified admins can queue sensor lifecycle commands."""

    csrf = await create_verified_admin(backend_client)
    await backend_client.store.create_sensor(
        Sensor(
            id="pi-1",
            name="Pi",
            tailnet_ip="100.64.0.1",
            version="0.1.0",
            capabilities=[SensorCapability.CHANNEL_CONTROL],
        )
    )

    restart = await backend_client.client.post(
        "/api/v1/sensors/pi-1/commands/restart",
        headers={"x-csrf-token": csrf},
    )
    update = await backend_client.client.post(
        "/api/v1/sensors/pi-1/commands/update",
        headers={"x-csrf-token": csrf},
    )
    channel = await backend_client.client.post(
        "/api/v1/sensors/pi-1/commands/set-channel",
        headers={"x-csrf-token": csrf},
        json={"channel": 11, "band": "2.4"},
    )

    assert restart.status_code == 202
    assert update.status_code == 202
    assert channel.status_code == 202
    assert restart.json()["command_id"]
    assert [log.action for log in backend_client.store.audit_logs[-3:]] == [
        "sensors.commands.restart",
        "sensors.commands.update",
        "sensors.commands.set_channel",
    ]


async def test_set_channel_requires_sensor_capability(backend_client: BackendClient) -> None:
    """Set-channel commands require the sensor to advertise channel control."""

    csrf = await create_verified_admin(backend_client)
    await backend_client.store.create_sensor(
        Sensor(id="pi-1", name="Pi", tailnet_ip="100.64.0.1", version="0.1.0")
    )

    response = await backend_client.client.post(
        "/api/v1/sensors/pi-1/commands/set-channel",
        headers={"x-csrf-token": csrf},
        json={"channel": 11, "band": "2.4"},
    )

    assert response.status_code == 409


async def test_set_channel_band_exports_literal_enum(backend_client: BackendClient) -> None:
    """OpenAPI exposes channel bands as a finite enum for generated clients."""

    response = await backend_client.client.get("/openapi.json")
    band = response.json()["components"]["schemas"]["SetChannelRequest"]["properties"]["band"]

    assert response.status_code == 200
    assert band["enum"] == ["2.4", "5", "6"]
