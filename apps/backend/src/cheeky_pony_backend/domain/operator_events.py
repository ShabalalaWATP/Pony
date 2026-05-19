# SPDX-License-Identifier: AGPL-3.0-only
"""Operator WebSocket event publication service."""

from __future__ import annotations

from typing import Any, Protocol

from cheeky_pony_backend.domain.alerts import AlertRuleEngine
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_shared import (
    AccessPoint,
    Alert,
    Client,
    Event,
    EventKind,
    Sensor,
    SensorCapability,
)


class OperatorPublisher(Protocol):
    """Minimal broadcast boundary for operator realtime topics."""

    async def broadcast(self, payload: dict[str, Any]) -> None:
        """Broadcast one operator WebSocket payload."""


async def publish_event(store: Store, publisher: OperatorPublisher, event: Event) -> None:
    """Persist a sensor event and publish the derived operator topics.

    Args:
        store: Application persistence boundary.
        publisher: Operator broadcast boundary.
        event: Validated event from the sensor gateway.
    """

    await store.insert_event(event)
    await publish_event_append(publisher, event)
    if event.kind == EventKind.ACCESS_POINT_SEEN:
        access_point = await _access_point_from_event(store, event)
        await store.upsert_access_point(access_point)
        await publish_access_point_upsert(publisher, access_point)
    if event.kind == EventKind.CLIENT_SEEN:
        client = Client.model_validate(event.payload)
        await store.upsert_client(client)
        await publish_client_upsert(publisher, client)
    if event.kind == EventKind.SENSOR_STATUS:
        sensor = await _update_sensor_status(store, event)
        if sensor is not None:
            await publish_sensor_update(publisher, sensor)
    for alert in await AlertRuleEngine(store).evaluate_event(event):
        await publish_alert_fire(publisher, alert)


async def publish_event_append(publisher: OperatorPublisher, event: Event) -> None:
    """Publish an `events.append` operator topic.

    Args:
        publisher: Operator broadcast boundary.
        event: Event payload to broadcast.
    """

    await publisher.broadcast({"kind": "events.append", "event": event.model_dump(mode="json")})


async def publish_access_point_upsert(
    publisher: OperatorPublisher,
    access_point: AccessPoint,
) -> None:
    """Publish an `aps.upsert` operator topic.

    Args:
        publisher: Operator broadcast boundary.
        access_point: Access point snapshot to broadcast.
    """

    await publisher.broadcast(
        {"kind": "aps.upsert", "access_point": access_point.model_dump(mode="json")}
    )


async def publish_client_upsert(publisher: OperatorPublisher, client: Client) -> None:
    """Publish a `devices.upsert` operator topic.

    Args:
        publisher: Operator broadcast boundary.
        client: Client snapshot to broadcast.
    """

    await publisher.broadcast({"kind": "devices.upsert", "client": client.model_dump(mode="json")})


async def publish_sensor_update(publisher: OperatorPublisher, sensor: Sensor) -> None:
    """Publish a `sensors.update` operator topic.

    Args:
        publisher: Operator broadcast boundary.
        sensor: Sensor status snapshot to broadcast.
    """

    await publisher.broadcast({"kind": "sensors.update", "sensor": sensor.model_dump(mode="json")})


async def publish_alert_fire(publisher: OperatorPublisher, alert: Alert) -> None:
    """Publish an `alerts.fire` operator topic.

    Args:
        publisher: Operator broadcast boundary.
        alert: Alert to broadcast.
    """

    await publisher.broadcast({"kind": "alerts.fire", "alert": alert.model_dump(mode="json")})


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
