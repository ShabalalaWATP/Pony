# SPDX-License-Identifier: AGPL-3.0-only
"""Repository protocols used by backend services and API dependencies."""

from __future__ import annotations

from typing import Protocol

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


class Store(Protocol):
    """Persistence operations required by the application."""

    async def ensure_indexes(self) -> None:
        """Create datastore indices."""

    async def count_users(self) -> int:
        """Return the number of users."""

    async def create_user(self, user: UserRecord) -> UserRecord:
        """Persist a user."""

    async def get_user_by_email(self, email: str) -> UserRecord | None:
        """Look up a user by email."""

    async def get_user(self, user_id: str) -> UserRecord | None:
        """Look up a user by id."""

    async def update_user(self, user: UserRecord) -> UserRecord:
        """Persist updated user fields."""

    async def create_sensor(self, sensor: Sensor) -> Sensor:
        """Persist a sensor."""

    async def list_sensors(self) -> list[Sensor]:
        """Return all sensors."""

    async def get_sensor(self, sensor_id: str) -> Sensor | None:
        """Return a sensor by id."""

    async def revoke_sensor(self, sensor_id: str) -> None:
        """Mark a sensor as revoked."""

    async def upsert_access_point(self, access_point: AccessPoint) -> AccessPoint:
        """Upsert an access point."""

    async def upsert_client(self, client: Client) -> Client:
        """Upsert a client device."""

    async def insert_event(self, event: Event) -> Event:
        """Append an event."""

    async def list_access_points(self, limit: int, offset: int) -> tuple[list[AccessPoint], int]:
        """List access points."""

    async def get_access_point(self, bssid: str) -> AccessPoint | None:
        """Return an access point by BSSID."""

    async def list_clients(self, limit: int, offset: int) -> tuple[list[Client], int]:
        """List client devices."""

    async def get_client(self, mac: str) -> Client | None:
        """Return a client by MAC."""

    async def list_events(self, limit: int, offset: int) -> tuple[list[Event], int]:
        """List events."""

    async def get_event(self, event_id: str) -> Event | None:
        """Return an event by id."""

    async def append_audit(self, audit_log: AuditLog) -> AuditLog:
        """Append an audit log."""

    async def list_audit(self, limit: int, offset: int) -> tuple[list[AuditLog], int]:
        """List audit logs."""

    async def create_acknowledgement(self, acknowledgement: SystemAcknowledgement) -> None:
        """Persist an acknowledgement."""

    async def has_acknowledgement(self, kind: str) -> bool:
        """Return whether an acknowledgement exists."""

    async def create_engagement(self, engagement: Engagement) -> Engagement:
        """Persist an engagement."""

    async def allow_target(self, engagement_id: str, kind: TargetKind, value: str) -> None:
        """Allow a target for an engagement."""

    async def target_allowed(self, engagement_id: str, kind: TargetKind, value: str) -> bool:
        """Return whether a target is allowed."""
