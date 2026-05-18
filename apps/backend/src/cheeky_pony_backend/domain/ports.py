# SPDX-License-Identifier: AGPL-3.0-only
"""Repository protocols used by backend services and API dependencies."""

from __future__ import annotations

from datetime import datetime
from typing import Protocol

from cheeky_pony_backend.domain.reports import ReportRecord
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_shared import (
    AccessPoint,
    Alert,
    AlertRule,
    AlertSeverity,
    AllowedTarget,
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

    async def list_users(self, limit: int, offset: int) -> tuple[list[UserRecord], int]:
        """List users in stable order."""

    async def update_user(self, user: UserRecord) -> UserRecord:
        """Persist updated user fields."""

    async def update_user_access(
        self,
        user_id: str,
        roles: list[str] | None,
        reset_totp: bool,
        actor_id: str,
    ) -> UserRecord | None:
        """Atomically update user roles or TOTP enrollment state."""

    async def create_sensor(self, sensor: Sensor) -> Sensor:
        """Persist a sensor."""

    async def list_sensors(self) -> list[Sensor]:
        """Return all sensors."""

    async def get_sensor(self, sensor_id: str) -> Sensor | None:
        """Return a sensor by id."""

    async def revoke_sensor(self, sensor_id: str) -> None:
        """Mark a sensor as revoked."""

    async def update_sensor(self, sensor: Sensor) -> Sensor:
        """Persist updated sensor fields."""

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

    async def list_clients_for_access_point(
        self,
        bssid: str,
        limit: int,
        offset: int,
    ) -> tuple[list[Client], int]:
        """List client devices associated to an access point."""

    async def get_client(self, mac: str) -> Client | None:
        """Return a client by MAC."""

    async def list_events(self, limit: int, offset: int) -> tuple[list[Event], int]:
        """List events."""

    async def get_event(self, event_id: str) -> Event | None:
        """Return an event by id."""

    async def insert_alert(self, alert: Alert) -> Alert:
        """Persist an alert."""

    async def list_alerts(
        self,
        limit: int,
        offset: int,
        severities: list[AlertSeverity] | None,
        acked: bool | None,
    ) -> tuple[list[Alert], int]:
        """List alerts."""

    async def get_alert(self, alert_id: str) -> Alert | None:
        """Return an alert by id."""

    async def update_alert(self, alert: Alert) -> Alert:
        """Persist updated alert fields."""

    async def create_alert_rule(self, rule: AlertRule) -> AlertRule:
        """Persist an alert rule."""

    async def list_alert_rules(self, limit: int, offset: int) -> tuple[list[AlertRule], int]:
        """List alert rules."""

    async def list_enabled_alert_rules(self) -> list[AlertRule]:
        """Return enabled alert rules."""

    async def get_alert_rule(self, rule_id: str) -> AlertRule | None:
        """Return an alert rule by id."""

    async def update_alert_rule(self, rule: AlertRule) -> AlertRule:
        """Persist updated alert rule fields."""

    async def delete_alert_rule(self, rule_id: str) -> None:
        """Delete an alert rule."""

    async def append_audit(self, audit_log: AuditLog) -> AuditLog:
        """Append an audit log."""

    async def list_audit(self, limit: int, offset: int) -> tuple[list[AuditLog], int]:
        """List audit logs."""

    async def count_synthetic_records(self) -> int:
        """Count seeded demo records across collections."""

    async def last_demo_seeded_at(self) -> datetime | None:
        """Return the last demo seed timestamp."""

    async def create_acknowledgement(self, acknowledgement: SystemAcknowledgement) -> None:
        """Persist an acknowledgement."""

    async def has_acknowledgement(self, kind: str) -> bool:
        """Return whether an acknowledgement exists."""

    async def create_engagement(self, engagement: Engagement) -> Engagement:
        """Persist an engagement."""

    async def list_engagements(self, limit: int, offset: int) -> tuple[list[Engagement], int]:
        """List engagements."""

    async def get_engagement(self, engagement_id: str) -> Engagement | None:
        """Return an engagement by id."""

    async def get_active_engagement(self) -> Engagement | None:
        """Return the active engagement when one exists."""

    async def update_engagement(self, engagement: Engagement) -> Engagement:
        """Persist updated engagement fields."""

    async def allow_target(self, engagement_id: str, kind: TargetKind, value: str) -> None:
        """Allow a target for an engagement."""

    async def list_allowed_targets(
        self,
        engagement_id: str,
        limit: int,
        offset: int,
    ) -> tuple[list[AllowedTarget], int]:
        """List allowed targets for an engagement."""

    async def remove_allowed_target(self, engagement_id: str, kind: TargetKind, value: str) -> None:
        """Remove an allowed target from an engagement."""

    async def target_allowed(self, engagement_id: str, kind: TargetKind, value: str) -> bool:
        """Return whether a target is allowed."""

    async def create_report(self, report: ReportRecord) -> ReportRecord:
        """Persist a report request."""

    async def get_report(self, engagement_id: str, report_id: str) -> ReportRecord | None:
        """Return a report by engagement and id."""

    async def get_report_by_id(self, report_id: str) -> ReportRecord | None:
        """Return a report by id."""

    async def update_report(self, report: ReportRecord) -> ReportRecord:
        """Persist updated report fields."""
