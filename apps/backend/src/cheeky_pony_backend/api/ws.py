# SPDX-License-Identifier: AGPL-3.0-only
"""Authenticated WebSocket endpoints for sensors and operators."""

from __future__ import annotations

import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.security import TokenService
from cheeky_pony_shared import AccessPoint, Client, Event, EventKind

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
    await websocket.accept()
    try:
        while True:
            payload = await websocket.receive_json()
            event = Event.model_validate(payload)
            await _persist_event(store, event)
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
    await websocket.accept()
    await websocket.send_json({"kind": "connected", "user_id": user.id})
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        return


async def _persist_event(store: Store, event: Event) -> None:
    await store.insert_event(event)
    if event.kind == EventKind.ACCESS_POINT_SEEN:
        await store.upsert_access_point(AccessPoint.model_validate(event.payload))
    if event.kind == EventKind.CLIENT_SEEN:
        await store.upsert_client(Client.model_validate(event.payload))
