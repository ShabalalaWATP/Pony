# SPDX-License-Identifier: AGPL-3.0-only
"""Authenticated WebSocket endpoints for sensors and operators."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.alerts import AlertRuleEngine
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.lab import sanitize_parameters
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.infra.operator_broker import OperatorBroker
from cheeky_pony_backend.infra.sensor_command_broker import (
    SensorCommandBroker,
    SensorCommandMetadata,
)
from cheeky_pony_backend.security import TokenService, verified_sensor_gateway_headers
from cheeky_pony_shared import (
    AccessPoint,
    AuditLog,
    Client,
    CommandKind,
    Event,
    EventKind,
    Sensor,
    SensorCapability,
)

router = APIRouter(prefix="/ws", tags=["websocket"])


@router.websocket("/sensor-gateway")
async def sensor_gateway(websocket: WebSocket) -> None:
    """Accept authenticated sensor events over WebSocket.

    Args:
        websocket: Sensor WebSocket.
    """

    store: Store = websocket.app.state.store
    settings: Settings = websocket.app.state.settings
    sensor_id = websocket.query_params.get("sensor_id")
    if not sensor_id:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    sensor = await store.get_sensor(sensor_id)
    if sensor is None or sensor.revoked:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    if not verified_sensor_gateway_headers(
        websocket.headers,
        settings.sensor_gateway_header_secret,
        sensor_id,
        sensor.client_cert_fingerprint_sha256,
        settings.sensor_gateway_header_skew_seconds,
    ):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    broker: OperatorBroker = websocket.app.state.operator_broker
    command_broker: SensorCommandBroker = websocket.app.state.sensor_command_broker
    await websocket.accept()
    await command_broker.connect(sensor_id, websocket)
    try:
        while True:
            payload = await websocket.receive_json()
            if _has_synthetic_marker(payload):
                await _reject_synthetic_marker(sensor_id, websocket, store)
                await command_broker.disconnect(sensor_id, websocket)
                return
            if await _handle_command_result(sensor_id, payload, store, broker, command_broker):
                continue
            if await _handle_lab_progress(sensor_id, payload, broker, command_broker):
                continue
            event = Event.model_validate(payload)
            if event.sensor_id != sensor_id:
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return
            await _persist_event(store, broker, event)
    except WebSocketDisconnect:
        await command_broker.disconnect(sensor_id, websocket)
        return


@router.websocket("/operator")
async def operator_gateway(websocket: WebSocket) -> None:
    """Accept authenticated operator WebSocket connections.

    Args:
        websocket: Operator WebSocket.
    """

    settings: Settings = websocket.app.state.settings
    store: Store = websocket.app.state.store
    if not _operator_origin_allowed(websocket, settings):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    token = websocket.cookies.get("access_token")
    if token is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    try:
        claims = TokenService(settings).verify(token, "access")
    except jwt.InvalidTokenError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    user = await store.get_user(str(claims["sub"]))
    if user is None or user.disabled:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    broker: OperatorBroker = websocket.app.state.operator_broker
    await websocket.accept()
    await broker.connect(websocket)
    await websocket.send_json({"kind": "connected", "user_id": user.id})
    try:
        while True:
            # Re-check Origin here before adding any client-pushed state mutation.
            await websocket.receive_text()
    except WebSocketDisconnect:
        await broker.disconnect(websocket)
        return


def _operator_origin_allowed(websocket: WebSocket, settings: Settings) -> bool:
    origin = websocket.headers.get("origin")
    return origin is not None and origin in settings.cors_origins


async def _reject_synthetic_marker(sensor_id: str, websocket: WebSocket, store: Store) -> None:
    await AuditLogger(store).record(
        sensor_id,
        "sensor.rejected_synthetic_marker",
        {"sensor_id": sensor_id},
        {},
        "denied:invalid_payload",
    )
    await websocket.send_json({"status_code": 400, "detail": "invalid_payload"})
    await websocket.close(code=status.WS_1003_UNSUPPORTED_DATA, reason="invalid_payload")


def _has_synthetic_marker(value: object) -> bool:
    if isinstance(value, dict):
        if value.get("synthetic") is True:
            return True
        return any(_has_synthetic_marker(item) for item in value.values())
    if isinstance(value, list):
        return any(_has_synthetic_marker(item) for item in value)
    return False


async def _persist_event(store: Store, broker: OperatorBroker, event: Event) -> None:
    await store.insert_event(event)
    await broker.broadcast({"kind": "events.append", "event": event.model_dump(mode="json")})
    if event.kind == EventKind.ACCESS_POINT_SEEN:
        access_point = await _access_point_from_event(store, event)
        await store.upsert_access_point(access_point)
        await broker.broadcast(
            {"kind": "aps.upsert", "access_point": access_point.model_dump(mode="json")}
        )
    if event.kind == EventKind.CLIENT_SEEN:
        client = Client.model_validate(event.payload)
        await store.upsert_client(client)
        await broker.broadcast({"kind": "devices.upsert", "client": client.model_dump(mode="json")})
    if event.kind == EventKind.SENSOR_STATUS:
        sensor = await _update_sensor_status(store, event)
        if sensor is not None:
            await broker.broadcast(
                {"kind": "sensors.update", "sensor": sensor.model_dump(mode="json")}
            )
    for alert in await AlertRuleEngine(store).evaluate_event(event):
        await broker.broadcast({"kind": "alerts.fire", "alert": alert.model_dump(mode="json")})


async def _access_point_from_event(store: Store, event: Event) -> AccessPoint:
    payload = dict(event.payload)
    location = payload.pop("location", None)
    access_point = AccessPoint.model_validate(payload)
    sensor = await store.get_sensor(event.sensor_id)
    if sensor is None or SensorCapability.GEO not in sensor.capabilities:
        return access_point
    if not isinstance(location, dict):
        return access_point
    return _with_sensor_location(access_point, location)


def _with_sensor_location(access_point: AccessPoint, location: dict[object, object]) -> AccessPoint:
    lat = location.get("lat")
    lng = location.get("lng")
    if not isinstance(lat, int | float) or not isinstance(lng, int | float):
        return access_point
    latitude = float(lat)
    longitude = float(lng)
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        return access_point
    payload = access_point.model_dump()
    payload.update(
        {
            "latitude": latitude,
            "longitude": longitude,
            "location_source": "sensor_gps",
        }
    )
    return AccessPoint.model_validate(payload)


async def _update_sensor_status(store: Store, event: Event) -> Sensor | None:
    sensor = await store.get_sensor(event.sensor_id)
    if sensor is None:
        return None
    updates: dict[str, object] = {"last_seen": event.occurred_at}
    if isinstance(event.payload.get("version"), str):
        updates["version"] = event.payload["version"]
    capabilities = _capabilities_from_payload(event.payload.get("capabilities"))
    if capabilities is not None:
        updates["capabilities"] = capabilities
    return await store.update_sensor(sensor.model_copy(update=updates))


def _capabilities_from_payload(value: object) -> list[SensorCapability] | None:
    if not isinstance(value, list):
        return None
    capabilities: list[SensorCapability] = []
    for item in value:
        try:
            capabilities.append(SensorCapability(str(item)))
        except ValueError:
            continue
    return capabilities


async def _handle_command_result(
    sensor_id: str,
    payload: object,
    store: Store,
    broker: OperatorBroker,
    command_broker: SensorCommandBroker,
) -> bool:
    if not isinstance(payload, dict) or payload.get("kind") != "command_result":
        return False
    result = payload.get("payload")
    if not isinstance(result, dict):
        return True
    command_id = str(result.get("command_id", ""))
    if not command_id:
        return True
    metadata = await command_broker.complete(command_id)
    if metadata is None:
        return True
    if metadata.lab_module is not None:
        await _handle_lab_command_result(sensor_id, metadata, result, store, broker, command_broker)
        return True
    audit = await _audit_command_result(store, metadata, result)
    await broker.broadcast(_command_result_message(sensor_id, metadata, result, audit))
    return True


async def _handle_lab_progress(
    sensor_id: str,
    payload: object,
    broker: OperatorBroker,
    command_broker: SensorCommandBroker,
) -> bool:
    if not isinstance(payload, dict) or payload.get("kind") != "lab.progress":
        return False
    command_id = str(payload.get("command_id", ""))
    progress = payload.get("progress")
    if not command_id or not isinstance(progress, dict):
        return True
    record = await command_broker.get_lab_command(command_id)
    if record is None or record.sensor_id != sensor_id:
        return True
    await broker.broadcast(
        {
            "kind": "lab.progress",
            "command_id": command_id,
            "module": record.module,
            "progress": sanitize_parameters(progress),
        }
    )
    return True


async def _handle_lab_command_result(
    sensor_id: str,
    metadata: SensorCommandMetadata,
    result: dict[Any, Any],
    store: Store,
    broker: OperatorBroker,
    command_broker: SensorCommandBroker,
) -> None:
    audit = await _audit_lab_command_result(store, metadata, result)
    if metadata.command == CommandKind.STOP_MODULE:
        await command_broker.stop_lab_command(metadata.command_id)
        await broker.broadcast(_lab_stopped_message(sensor_id, metadata, result, audit))
        return
    if metadata.command == CommandKind.START_MODULE and result.get("accepted") is not True:
        await command_broker.stop_lab_command(metadata.command_id)
        await broker.broadcast(_lab_stopped_message(sensor_id, metadata, result, audit))


async def _audit_command_result(
    store: Store,
    metadata: SensorCommandMetadata,
    result: dict[Any, Any],
) -> AuditLog:
    finished_at = datetime.now(tz=UTC)
    accepted = result.get("accepted") is True
    return await AuditLogger(store).record(
        metadata.actor_id,
        f"sensors.commands.{metadata.command.value}.result",
        {"sensor_id": metadata.sensor_id, "command_id": metadata.command_id},
        {
            "accepted": accepted,
            "sensor_outcome": str(result.get("outcome", "")),
            "start_audit_id": metadata.audit_id,
        },
        "ok" if accepted else "error",
        started_at=metadata.started_at,
        finished_at=finished_at,
        raw_tool_output_ref=f"sensor-command:{metadata.command_id}",
    )


async def _audit_lab_command_result(
    store: Store,
    metadata: SensorCommandMetadata,
    result: dict[Any, Any],
) -> AuditLog:
    finished_at = datetime.now(tz=UTC)
    accepted = result.get("accepted") is True
    phase = "stop" if metadata.command == CommandKind.STOP_MODULE else "start"
    return await AuditLogger(store).record(
        metadata.actor_id,
        f"lab.{metadata.lab_module}.{phase}.result",
        {
            "sensor_id": metadata.sensor_id,
            "command_id": metadata.command_id,
            "engagement_id": metadata.engagement_id,
            "target": metadata.target or {},
        },
        {
            "accepted": accepted,
            "sensor_outcome": str(result.get("outcome", "")),
            "start_audit_id": metadata.audit_id,
        },
        "ok" if accepted else "error",
        started_at=metadata.started_at,
        finished_at=finished_at,
        raw_tool_output_ref=f"sensor-command:{metadata.command_id}",
    )


def _command_result_message(
    sensor_id: str,
    metadata: SensorCommandMetadata,
    result: dict[Any, Any],
    audit: AuditLog,
) -> dict[str, Any]:
    accepted = result.get("accepted") is True
    finished_at = audit.finished_at or datetime.now(tz=UTC)
    return {
        "kind": "command_result",
        "sensor_id": sensor_id,
        "command_id": metadata.command_id,
        "command": metadata.command.value,
        "outcome": "ok" if accepted else "error",
        "started_at": metadata.started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "audit_id": audit.id,
    }


def _lab_stopped_message(
    sensor_id: str,
    metadata: SensorCommandMetadata,
    result: dict[Any, Any],
    audit: AuditLog,
) -> dict[str, Any]:
    accepted = result.get("accepted") is True
    finished_at = audit.finished_at or datetime.now(tz=UTC)
    return {
        "kind": "lab.stopped",
        "command_id": metadata.command_id,
        "module": metadata.lab_module,
        "sensor_id": sensor_id,
        "outcome": "ok" if accepted else "error",
        "finished_at": finished_at.isoformat(),
        "audit_id": audit.id,
    }
