# SPDX-License-Identifier: AGPL-3.0-only
"""Authenticated WebSocket endpoints for sensors and operators."""

from __future__ import annotations

import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.alerts import AlertRuleEngine
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.infra.operator_broker import OperatorBroker
from cheeky_pony_backend.security import TokenService
from cheeky_pony_shared import AccessPoint, Client, Event, EventKind, Sensor, SensorCapability

router = APIRouter(prefix="/ws", tags=["websocket"])


@router.websocket("/sensor-gateway")
async def sensor_gateway(websocket: WebSocket) -> None:
    """Accept authenticated sensor events over WebSocket.

    Args:
        websocket: Sensor WebSocket.
    """

    store: Store = websocket.app.state.store
    subject = websocket.headers.get("x-client-cert-subject")
    sensor_id = websocket.query_params.get("sensor_id")
    if not subject or not sensor_id:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    sensor = await store.get_sensor(sensor_id)
    if sensor is None or sensor.revoked:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    broker: OperatorBroker = websocket.app.state.operator_broker
    await websocket.accept()
    try:
        while True:
            payload = await websocket.receive_json()
            event = Event.model_validate(payload)
            await _persist_event(store, broker, event)
    except WebSocketDisconnect:
        return


@router.websocket("/operator")
async def operator_gateway(websocket: WebSocket) -> None:
    """Accept authenticated operator WebSocket connections.

    Args:
        websocket: Operator WebSocket.
    """

    settings: Settings = websocket.app.state.settings
    store: Store = websocket.app.state.store
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
    if user is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    broker: OperatorBroker = websocket.app.state.operator_broker
    await websocket.accept()
    await broker.connect(websocket)
    await websocket.send_json({"kind": "connected", "user_id": user.id})
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await broker.disconnect(websocket)
        return


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
