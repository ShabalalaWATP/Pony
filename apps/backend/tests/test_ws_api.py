# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for backend WebSocket gateways."""

from __future__ import annotations

from fastapi.testclient import TestClient

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.infra.in_memory_store import InMemoryStore
from cheeky_pony_backend.main import create_app
from cheeky_pony_backend.security import TokenService
from cheeky_pony_shared import Sensor


def test_sensor_gateway_persists_access_point_event() -> None:
    """Sensor gateway accepts authenticated sensor events."""

    store = InMemoryStore()
    app = create_app(_settings(), store)
    _run(
        store.create_sensor(Sensor(id="pi-1", name="Pi", tailnet_ip="100.64.0.1", version="0.1.0"))
    )

    with TestClient(app) as client:
        with client.websocket_connect(
            "/ws/sensor-gateway?sensor_id=pi-1",
            headers={"x-client-cert-subject": "CN=pi-1"},
        ) as websocket:
            websocket.send_json(
                {
                    "id": "evt-1",
                    "sensor_id": "pi-1",
                    "kind": "access_point_seen",
                    "payload": {
                        "bssid": "AA:BB:CC:DD:EE:FF",
                        "ssid": "Lab",
                        "channel": 6,
                    },
                }
            )

    assert store.events[0].id == "evt-1"
    assert "AA:BB:CC:DD:EE:FF" in store.access_points


def test_operator_gateway_requires_jwt_cookie() -> None:
    """Operator gateway authenticates by JWT cookie."""

    settings = _settings()
    store = InMemoryStore()
    app = create_app(settings, store)
    _run(
        store.create_user(
            UserRecord(
                id="user-1",
                email="admin@example.com",
                password_hash="hash",
                roles=["admin"],
            )
        )
    )
    token = TokenService(settings).create_access_token("user-1", "csrf")

    with TestClient(app) as client:
        client.cookies.set("access_token", token)
        with client.websocket_connect("/ws/operator") as websocket:
            assert websocket.receive_json()["kind"] == "connected"


def _settings() -> Settings:
    return Settings(
        env="test",
        cookie_secure=False,
        jwt_secret="test-secret-test-secret-test-secret-123",
        use_in_memory_store=True,
    )


def _run(awaitable):  # type: ignore[no-untyped-def]
    import asyncio

    return asyncio.run(awaitable)
