# SPDX-License-Identifier: AGPL-3.0-only
"""In-memory store used for tests and local no-database execution."""

from __future__ import annotations

import asyncio

from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_shared import (
    AccessPoint,
    AuditLog,
    Client,
    Engagement,
    Event,
    Sensor,
    SystemAcknowledgement,
    TargetKind,
)


class InMemoryStore:
    """Async in-memory implementation of the application store."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self.users: dict[str, UserRecord] = {}
        self.sensors: dict[str, Sensor] = {}
        self.access_points: dict[str, AccessPoint] = {}
        self.clients: dict[str, Client] = {}
        self.events: list[Event] = []
        self.audit_logs: list[AuditLog] = []
        self.acknowledgements: dict[str, SystemAcknowledgement] = {}
        self.engagements: dict[str, Engagement] = {}
        self.allow_list: set[tuple[str, TargetKind, str]] = set()

    async def ensure_indexes(self) -> None:
        """No-op for in-memory storage."""

    async def count_users(self) -> int:
        """Return the number of users."""

        return len(self.users)

    async def create_user(self, user: UserRecord) -> UserRecord:
        """Persist a user."""

        async with self._lock:
            self.users[user.id] = user
        return user

    async def get_user_by_email(self, email: str) -> UserRecord | None:
        """Look up a user by email."""

        return next((user for user in self.users.values() if user.email == email), None)

    async def get_user(self, user_id: str) -> UserRecord | None:
        """Look up a user by id."""

        return self.users.get(user_id)

    async def update_user(self, user: UserRecord) -> UserRecord:
        """Persist updated user fields."""

        async with self._lock:
            self.users[user.id] = user
        return user

    async def create_sensor(self, sensor: Sensor) -> Sensor:
        """Persist a sensor."""

        async with self._lock:
            self.sensors[sensor.id] = sensor
        return sensor

    async def list_sensors(self) -> list[Sensor]:
        """Return all sensors."""

        return list(self.sensors.values())

    async def get_sensor(self, sensor_id: str) -> Sensor | None:
        """Return a sensor by id."""

        return self.sensors.get(sensor_id)

    async def revoke_sensor(self, sensor_id: str) -> None:
        """Mark a sensor as revoked."""

        sensor = self.sensors.get(sensor_id)
        if sensor is not None:
            self.sensors[sensor_id] = sensor.model_copy(update={"revoked": True})

    async def upsert_access_point(self, access_point: AccessPoint) -> AccessPoint:
        """Upsert an access point."""

        self.access_points[access_point.bssid] = access_point
        return access_point

    async def upsert_client(self, client: Client) -> Client:
        """Upsert a client device."""

        self.clients[client.mac] = client
        return client

    async def insert_event(self, event: Event) -> Event:
        """Append an event."""

        self.events.append(event)
        return event

    async def list_access_points(self, limit: int, offset: int) -> tuple[list[AccessPoint], int]:
        """List access points."""

        values = list(self.access_points.values())
        return values[offset : offset + limit], len(values)

    async def get_access_point(self, bssid: str) -> AccessPoint | None:
        """Return an access point by BSSID."""

        return self.access_points.get(bssid.upper())

    async def list_clients(self, limit: int, offset: int) -> tuple[list[Client], int]:
        """List client devices."""

        values = list(self.clients.values())
        return values[offset : offset + limit], len(values)

    async def get_client(self, mac: str) -> Client | None:
        """Return a client by MAC."""

        return self.clients.get(mac.upper())

    async def list_events(self, limit: int, offset: int) -> tuple[list[Event], int]:
        """List events."""

        return self.events[offset : offset + limit], len(self.events)

    async def get_event(self, event_id: str) -> Event | None:
        """Return an event by id."""

        return next((event for event in self.events if event.id == event_id), None)

    async def append_audit(self, audit_log: AuditLog) -> AuditLog:
        """Append an audit log."""

        self.audit_logs.append(audit_log)
        return audit_log

    async def list_audit(self, limit: int, offset: int) -> tuple[list[AuditLog], int]:
        """List audit logs."""

        return self.audit_logs[offset : offset + limit], len(self.audit_logs)

    async def create_acknowledgement(self, acknowledgement: SystemAcknowledgement) -> None:
        """Persist an acknowledgement."""

        self.acknowledgements[acknowledgement.kind] = acknowledgement

    async def has_acknowledgement(self, kind: str) -> bool:
        """Return whether an acknowledgement exists."""

        return kind in self.acknowledgements

    async def create_engagement(self, engagement: Engagement) -> Engagement:
        """Persist an engagement."""

        self.engagements[engagement.id] = engagement
        return engagement

    async def allow_target(self, engagement_id: str, kind: TargetKind, value: str) -> None:
        """Allow a target for an engagement."""

        self.allow_list.add((engagement_id, kind, value.upper()))

    async def target_allowed(self, engagement_id: str, kind: TargetKind, value: str) -> bool:
        """Return whether a target is allowed."""

        return (engagement_id, kind, value.upper()) in self.allow_list
