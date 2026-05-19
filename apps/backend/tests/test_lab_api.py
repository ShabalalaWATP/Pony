# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for gated active lab module APIs."""

from __future__ import annotations

from datetime import UTC, datetime

import httpx
import pytest
from fastapi.testclient import TestClient
from helpers import create_verified_admin

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.dependencies import reset_auth_rate_limiters
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.infra.in_memory_store import InMemoryStore
from cheeky_pony_backend.main import create_app
from cheeky_pony_backend.security import TokenService, sign_sensor_gateway_headers
from cheeky_pony_shared import (
    Engagement,
    Sensor,
    SensorCapability,
    SystemAcknowledgement,
    TargetKind,
)

SENSOR_FINGERPRINT = "b" * 64
SENSOR_HEADER_VALUE = "".join(["test-", "lab-", "sensor-", "header-", "value-", "1234567890"])
OPERATOR_ORIGIN = "http://localhost:5173"


@pytest.mark.asyncio
async def test_lab_status_reports_gate_inputs() -> None:
    """Operators can inspect lab gate status before starting a module."""

    bundle = await _prepared_lab_client()

    response = await bundle.client.get("/api/v1/lab/status")

    assert response.status_code == 200
    assert response.json() == {
        "lab_mode": True,
        "acknowledgement_on_file": True,
        "is_admin_2fa": True,
    }

    await bundle.client.aclose()


@pytest.mark.asyncio
async def test_lab_start_refuses_with_structured_reason_and_audit() -> None:
    """Disabled lab mode returns the frontend-friendly refusal shape and audits."""

    bundle = await _lab_client(lab_mode=False)
    csrf = await create_verified_admin(bundle)

    response = await bundle.client.post(
        "/api/v1/lab/deauth/start",
        headers={"x-csrf-token": csrf},
        json=_start_payload(),
    )

    assert response.status_code == 403
    assert response.json()["reason"] == "lab_mode_disabled"
    assert bundle.store.audit_logs[-1].outcome == "denied:lab_mode_disabled"

    await bundle.client.aclose()


@pytest.mark.asyncio
async def test_lab_start_enforces_acknowledgement_and_allow_list() -> None:
    """The non-negotiable acknowledgement and allow-list gates fire before start."""

    bundle = await _prepared_lab_client(acknowledged=False, allow_target=False)
    csrf = bundle.csrf

    no_ack = await bundle.client.post(
        "/api/v1/lab/deauth/start",
        headers={"x-csrf-token": csrf},
        json=_start_payload(),
    )
    await _acknowledge(bundle.store)
    not_allowed = await bundle.client.post(
        "/api/v1/lab/deauth/start",
        headers={"x-csrf-token": csrf},
        json=_start_payload(),
    )

    assert no_ack.status_code == 403
    assert no_ack.json()["reason"] == "no_acknowledgement"
    assert not_allowed.status_code == 403
    assert not_allowed.json()["reason"] == "target_not_in_allowlist"

    await bundle.client.aclose()


@pytest.mark.asyncio
async def test_lab_start_returns_active_command_page() -> None:
    """A gated start queues a lab command and exposes it in /lab/active."""

    bundle = await _prepared_lab_client()

    started = await bundle.client.post(
        "/api/v1/lab/deauth/start",
        headers={"x-csrf-token": bundle.csrf},
        json=_start_payload(
            parameters={"reason": "integration-test", "nested": {"password": "hidden"}}
        ),
    )
    active = await bundle.client.get("/api/v1/lab/active")

    assert started.status_code == 202
    assert started.json()["command_id"]
    assert active.status_code == 200
    assert active.json()["total"] == 1
    assert active.json()["items"][0]["module"] == "deauth"
    assert bundle.store.audit_logs[-1].outcome == "started"
    assert (
        bundle.store.audit_logs[-1].parameters["parameters"]["nested"]["password"] == "[redacted]"
    )

    await bundle.client.aclose()


def test_lab_start_stop_commands_flow_over_sensor_gateway() -> None:
    """Start and stop commands are delivered to sensors with lab WS messages."""

    settings, store, app = _lab_app()
    _seed_lab_state(store)
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
                started = client.post(
                    "/api/v1/lab/deauth/start",
                    headers={"x-csrf-token": "csrf"},
                    json=_start_payload(),
                )
                start_command = sensor.receive_json()
                lab_started = operator.receive_json()
                sensor.send_json(
                    {
                        "kind": "lab.progress",
                        "command_id": started.json()["command_id"],
                        "progress": {"deauths_sent": 3, "secret_token": "hidden"},
                    }
                )
                lab_progress = operator.receive_json()
                stopped = client.post(
                    f"/api/v1/lab/deauth/stop/{started.json()['command_id']}",
                    headers={"x-csrf-token": "csrf"},
                )
                stop_command = sensor.receive_json()
                sensor.send_json(_command_result(started.json()["command_id"]))
                lab_stopped = operator.receive_json()

    assert started.status_code == 202
    assert stopped.status_code == 204
    assert start_command["kind"] == "start_module"
    assert start_command["lab_mode"] is True
    assert start_command["parameters"]["module"] == "deauth"
    assert lab_started["kind"] == "lab.started"
    assert lab_progress["kind"] == "lab.progress"
    assert lab_progress["progress"]["deauths_sent"] == 3
    assert lab_progress["progress"]["secret_token"] == "[redacted]"
    assert stop_command["kind"] == "stop_module"
    assert lab_stopped["kind"] == "lab.stopped"
    assert lab_stopped["outcome"] == "ok"
    assert len([log for log in store.audit_logs if log.action.startswith("lab.deauth")]) == 3


class LabBundle:
    """Async lab test bundle."""

    def __init__(self, client: httpx.AsyncClient, store: InMemoryStore, csrf: str = "") -> None:
        self.client = client
        self.store = store
        self.csrf = csrf


async def _lab_client(lab_mode: bool) -> LabBundle:
    reset_auth_rate_limiters()
    settings = _settings(lab_mode)
    store = InMemoryStore()
    app = create_app(settings=settings, store=store)
    transport = httpx.ASGITransport(app=app)
    client = httpx.AsyncClient(transport=transport, base_url="http://test")
    return LabBundle(client, store)


async def _prepared_lab_client(
    acknowledged: bool = True,
    allow_target: bool = True,
) -> LabBundle:
    bundle = await _lab_client(lab_mode=True)
    bundle.csrf = await create_verified_admin(bundle)
    await _seed_async_lab_state(bundle.store, acknowledged, allow_target)
    return bundle


async def _seed_async_lab_state(
    store: InMemoryStore,
    acknowledged: bool,
    allow_target: bool,
) -> None:
    await store.create_sensor(_sensor())
    await store.create_engagement(Engagement(id="eng-1", name="Lab"))
    if allow_target:
        await store.allow_target("eng-1", TargetKind.BSSID, "AA:BB:CC:DD:EE:FF")
    if acknowledged:
        await _acknowledge(store)


async def _acknowledge(store: InMemoryStore) -> None:
    await store.create_acknowledgement(
        SystemAcknowledgement(
            kind="authorized_operator",
            accepted_by="user-1",
            statement_hash="x" * 64,
        )
    )


def _lab_app() -> tuple[Settings, InMemoryStore, object]:
    settings = _settings(lab_mode=True)
    store = InMemoryStore()
    app = create_app(settings=settings, store=store)
    return settings, store, app


def _seed_lab_state(store: InMemoryStore) -> None:
    import asyncio

    async def seed() -> None:
        await store.create_user(
            UserRecord(
                id="user-1",
                email="admin@example.com",
                password_hash="hash",
                roles=["admin"],
                totp_verified_at=datetime.now(tz=UTC),
            )
        )
        await _seed_async_lab_state(store, acknowledged=True, allow_target=True)

    asyncio.run(seed())


def _settings(lab_mode: bool) -> Settings:
    return Settings(
        env="test",
        lab_mode=lab_mode,
        cookie_secure=False,
        jwt_secret="j" * 32,
        bootstrap_token="bootstrap-" + "token-test",
        sensor_gateway_header_secret=SENSOR_HEADER_VALUE,
        use_in_memory_store=True,
    )


def _sensor() -> Sensor:
    return Sensor(
        id="pi-1",
        name="Pi",
        tailnet_ip="100.64.0.1",
        version="0.1.0",
        capabilities=[SensorCapability.ACTIVE_MODULES, SensorCapability.DEAUTH],
        client_cert_fingerprint_sha256=SENSOR_FINGERPRINT,
    )


def _sensor_headers() -> dict[str, str]:
    return sign_sensor_gateway_headers(
        SENSOR_HEADER_VALUE,
        "pi-1",
        "CN=pi-1",
        SENSOR_FINGERPRINT,
    )


def _start_payload(parameters: dict[str, object] | None = None) -> dict[str, object]:
    return {
        "sensor_id": "pi-1",
        "engagement_id": "eng-1",
        "target": {"kind": "bssid", "value": "AA:BB:CC:DD:EE:FF"},
        "parameters": parameters or {},
    }


def _command_result(command_id: str) -> dict[str, object]:
    return {
        "kind": "command_result",
        "payload": {"command_id": command_id, "accepted": True, "outcome": "stopped"},
    }
