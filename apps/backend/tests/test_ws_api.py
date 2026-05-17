# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for backend WebSocket gateways."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.infra.in_memory_store import InMemoryStore
from cheeky_pony_backend.main import create_app
from cheeky_pony_backend.security import TokenService, sign_sensor_gateway_headers
from cheeky_pony_shared import AlertRule, AlertSeverity, Sensor, SensorCapability

SENSOR_FINGERPRINT = "a" * 64
SENSOR_HEADER_VALUE = "".join(["test-", "sensor-", "header-", "value-", "1234567890"])
OPERATOR_ORIGIN = "http://localhost:5173"


def test_sensor_gateway_persists_access_point_event() -> None:
    """Sensor gateway accepts authenticated sensor events."""

    store = InMemoryStore()
    app = create_app(_settings(), store)
    _run(store.create_sensor(_sensor()))

    with TestClient(app) as client:
        with client.websocket_connect(
            "/ws/sensor-gateway?sensor_id=pi-1",
            headers=_sensor_headers(),
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
        with client.websocket_connect(
            "/ws/operator",
            headers={"origin": OPERATOR_ORIGIN},
        ) as websocket:
            assert websocket.receive_json()["kind"] == "connected"


def test_operator_gateway_rejects_foreign_origin() -> None:
    """Operator gateway rejects cookie-authenticated cross-origin sockets."""

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
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(
                "/ws/operator",
                headers={"origin": "https://evil.example"},
            ):
                pass


def test_sensor_gateway_rejects_unsigned_certificate_headers() -> None:
    """Sensor identity headers must be signed by the trusted proxy layer."""

    store = InMemoryStore()
    app = create_app(_settings(), store)
    _run(store.create_sensor(_sensor()))

    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(
                "/ws/sensor-gateway?sensor_id=pi-1",
                headers={"x-client-cert-subject": "CN=pi-1"},
            ):
                pass


def test_sensor_gateway_broadcasts_operator_topics_and_geo() -> None:
    """Sensor events emit the locked operator WebSocket message contract."""

    settings, app = _app_with_geo_sensor_and_user()
    token = TokenService(settings).create_access_token("user-1", "csrf")

    with TestClient(app) as client:
        client.cookies.set("access_token", token)
        with client.websocket_connect(
            "/ws/operator",
            headers={"origin": OPERATOR_ORIGIN},
        ) as operator:
            assert operator.receive_json() == {"kind": "connected", "user_id": "user-1"}
            with client.websocket_connect(
                "/ws/sensor-gateway?sensor_id=pi-1",
                headers=_sensor_headers(),
            ) as sensor:
                sensor.send_json(_ap_event_payload())
                assert operator.receive_json()["kind"] == "events.append"
                ap_message = operator.receive_json()

                sensor.send_json(_client_event_payload())
                assert operator.receive_json()["kind"] == "events.append"
                client_message = operator.receive_json()

                sensor.send_json(_sensor_status_payload())
                assert operator.receive_json()["kind"] == "events.append"
                sensor_message = operator.receive_json()

    assert ap_message["kind"] == "aps.upsert"
    assert ap_message["access_point"]["latitude"] == 51.5
    assert ap_message["access_point"]["location_source"] == "sensor_gps"
    assert client_message["kind"] == "devices.upsert"
    assert client_message["client"]["associated_bssid"] == "AA:BB:CC:DD:EE:FF"
    assert sensor_message["kind"] == "sensors.update"
    assert sensor_message["sensor"]["version"] == "0.2.0"


def test_sensor_gateway_broadcasts_alert_fire() -> None:
    """Matching alert rules emit alerts.fire to operators."""

    settings, app = _app_with_alert_rule()
    token = TokenService(settings).create_access_token("user-1", "csrf")

    with TestClient(app) as client:
        client.cookies.set("access_token", token)
        with client.websocket_connect(
            "/ws/operator",
            headers={"origin": OPERATOR_ORIGIN},
        ) as operator:
            assert operator.receive_json()["kind"] == "connected"
            with client.websocket_connect(
                "/ws/sensor-gateway?sensor_id=pi-1",
                headers=_sensor_headers(),
            ) as sensor:
                sensor.send_json(_free_ap_event_payload())
                messages = [operator.receive_json() for _ in range(3)]

    alert_message = next(message for message in messages if message["kind"] == "alerts.fire")
    assert {message["kind"] for message in messages} == {
        "events.append",
        "aps.upsert",
        "alerts.fire",
    }
    assert alert_message["alert"]["rule_id"] == "rule-1"
    assert alert_message["alert"]["severity"] == "high"


def test_sensor_command_endpoint_sends_and_broadcasts_result() -> None:
    """Lifecycle command endpoints send commands and broadcast sensor completion."""

    settings, app, store = _app_with_command_sensor_and_admin()
    token = TokenService(settings).create_access_token("user-1", "csrf")

    with TestClient(app) as client:
        client.cookies.set("access_token", token)
        with client.websocket_connect(
            "/ws/operator",
            headers={"origin": OPERATOR_ORIGIN},
        ) as operator:
            assert operator.receive_json()["kind"] == "connected"
            with client.websocket_connect(
                "/ws/sensor-gateway?sensor_id=pi-1",
                headers=_sensor_headers(),
            ) as sensor:
                response = client.post(
                    "/api/v1/sensors/pi-1/commands/set-channel",
                    headers={"x-csrf-token": "csrf"},
                    json={"channel": 44, "band": "5"},
                )
                command = sensor.receive_json()
                sensor.send_json(_command_result_payload(response.json()["command_id"]))
                result = operator.receive_json()

    assert response.status_code == 202
    assert command["kind"] == "set_channel"
    assert command["parameters"] == {"channel": 44, "band": "5"}
    assert result["kind"] == "command_result"
    assert result["command"] == "set_channel"
    assert result["outcome"] == "ok"
    assert result["audit_id"] == store.audit_logs[-1].id
    assert [log.action for log in store.audit_logs] == [
        "sensors.commands.set_channel",
        "sensors.commands.set_channel.result",
    ]


def _app_with_geo_sensor_and_user() -> tuple[Settings, FastAPI]:
    settings = _settings()
    store = InMemoryStore()
    app = create_app(settings, store)
    _run(
        store.create_sensor(
            _sensor(
                id="pi-1",
                name="Pi",
                tailnet_ip="100.64.0.1",
                version="0.1.0",
                capabilities=[SensorCapability.GEO],
            )
        )
    )
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
    return settings, app


def _app_with_command_sensor_and_admin() -> tuple[Settings, FastAPI, InMemoryStore]:
    settings = _settings()
    store = InMemoryStore()
    app = create_app(settings, store)
    _run(
        store.create_sensor(
            _sensor(
                id="pi-1",
                name="Pi",
                tailnet_ip="100.64.0.1",
                version="0.1.0",
                capabilities=[SensorCapability.CHANNEL_CONTROL],
            )
        )
    )
    _run(
        store.create_user(
            UserRecord(
                id="user-1",
                email="admin@example.com",
                password_hash="hash",
                roles=["admin"],
                totp_verified_at=datetime.now(tz=UTC),
            )
        )
    )
    return settings, app, store


def _app_with_alert_rule() -> tuple[Settings, FastAPI]:
    settings = _settings()
    store = InMemoryStore()
    app = create_app(settings, store)
    _run(store.create_sensor(_sensor()))
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
    _run(store.create_alert_rule(_free_ssid_rule()))
    return settings, app


def _settings() -> Settings:
    return Settings(
        env="test",
        cookie_secure=False,
        jwt_secret="test-secret-test-secret-test-secret-123",
        sensor_gateway_header_secret=SENSOR_HEADER_VALUE,
        use_in_memory_store=True,
    )


def _sensor(
    *,
    id: str = "pi-1",
    name: str = "Pi",
    tailnet_ip: str = "100.64.0.1",
    version: str = "0.1.0",
    capabilities: list[SensorCapability] | None = None,
) -> Sensor:
    return Sensor(
        id=id,
        name=name,
        tailnet_ip=tailnet_ip,
        version=version,
        capabilities=capabilities or [],
        client_cert_fingerprint_sha256=SENSOR_FINGERPRINT,
    )


def _sensor_headers(sensor_id: str = "pi-1") -> dict[str, str]:
    return sign_sensor_gateway_headers(
        SENSOR_HEADER_VALUE,
        sensor_id,
        f"CN={sensor_id}",
        SENSOR_FINGERPRINT,
    )


def _run(awaitable):  # type: ignore[no-untyped-def]
    import asyncio

    return asyncio.run(awaitable)


def _free_ssid_rule() -> AlertRule:
    return AlertRule(
        id="rule-1",
        name="Free SSID",
        severity=AlertSeverity.HIGH,
        predicate={"event_kind": "access_point_seen", "match": {"ssid": "^Free"}},
        created_by="user-1",
    )


def _ap_event_payload() -> dict[str, object]:
    return {
        "id": "evt-ap",
        "sensor_id": "pi-1",
        "kind": "access_point_seen",
        "payload": {
            "bssid": "AA:BB:CC:DD:EE:FF",
            "ssid": "Lab",
            "channel": 6,
            "location": {"lat": 51.5, "lng": -0.12},
        },
    }


def _free_ap_event_payload() -> dict[str, object]:
    return {
        "id": "evt-free-ap",
        "sensor_id": "pi-1",
        "kind": "access_point_seen",
        "payload": {
            "bssid": "AA:BB:CC:DD:EE:FF",
            "ssid": "Free Lab",
            "channel": 6,
        },
    }


def _command_result_payload(command_id: str) -> dict[str, object]:
    return {
        "kind": "command_result",
        "payload": {"command_id": command_id, "accepted": True, "outcome": "channel_set"},
    }


def _client_event_payload() -> dict[str, object]:
    return {
        "id": "evt-client",
        "sensor_id": "pi-1",
        "kind": "client_seen",
        "payload": {
            "mac": "11:22:33:44:55:66",
            "associated_bssid": "AA:BB:CC:DD:EE:FF",
        },
    }


def _sensor_status_payload() -> dict[str, object]:
    return {
        "id": "evt-status",
        "sensor_id": "pi-1",
        "kind": "sensor_status",
        "payload": {"version": "0.2.0", "capabilities": ["geo"]},
    }
