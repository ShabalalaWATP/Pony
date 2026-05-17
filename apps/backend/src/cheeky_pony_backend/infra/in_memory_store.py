# SPDX-License-Identifier: AGPL-3.0-only
"""In-memory store used for tests and local no-database execution."""

from __future__ import annotations

import asyncio

from cheeky_pony_backend.domain.reports import ReportRecord
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.infra.in_memory_users import InMemoryUserStoreMixin
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


class InMemoryStore(InMemoryUserStoreMixin):
    """Async in-memory implementation of the application store."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self.users: dict[str, UserRecord] = {}
        self.sensors: dict[str, Sensor] = {}
        self.access_points: dict[str, AccessPoint] = {}
        self.clients: dict[str, Client] = {}
        self.events: list[Event] = []
        self.alerts: dict[str, Alert] = {}
        self.alert_rules: dict[str, AlertRule] = {}
        self.audit_logs: list[AuditLog] = []
        self.acknowledgements: dict[str, SystemAcknowledgement] = {}
        self.engagements: dict[str, Engagement] = {}
        self.allow_list: set[tuple[str, TargetKind, str]] = set()
        self.reports: dict[str, ReportRecord] = {}

    async def ensure_indexes(self) -> None:
        """No-op for in-memory storage."""

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

    async def update_sensor(self, sensor: Sensor) -> Sensor:
        """Persist updated sensor fields."""

        async with self._lock:
            self.sensors[sensor.id] = sensor
        return sensor

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

    async def list_clients_for_access_point(
        self,
        bssid: str,
        limit: int,
        offset: int,
    ) -> tuple[list[Client], int]:
        """List client devices associated to an access point."""

        normalized = bssid.upper()
        values = [
            client
            for client in self.clients.values()
            if client.associated_bssid and client.associated_bssid.upper() == normalized
        ]
        values.sort(key=lambda client: client.last_seen, reverse=True)
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

    async def insert_alert(self, alert: Alert) -> Alert:
        """Persist an alert."""

        async with self._lock:
            self.alerts[alert.id] = alert
        return alert

    async def list_alerts(
        self,
        limit: int,
        offset: int,
        severities: list[AlertSeverity] | None,
        acked: bool | None,
    ) -> tuple[list[Alert], int]:
        """List alerts."""

        values = list(reversed(self.alerts.values()))
        values = _filter_alerts(values, severities, acked)
        return values[offset : offset + limit], len(values)

    async def get_alert(self, alert_id: str) -> Alert | None:
        """Return an alert by id."""

        return self.alerts.get(alert_id)

    async def update_alert(self, alert: Alert) -> Alert:
        """Persist updated alert fields."""

        async with self._lock:
            self.alerts[alert.id] = alert
        return alert

    async def create_alert_rule(self, rule: AlertRule) -> AlertRule:
        """Persist an alert rule."""

        async with self._lock:
            self.alert_rules[rule.id] = rule
        return rule

    async def list_alert_rules(self, limit: int, offset: int) -> tuple[list[AlertRule], int]:
        """List alert rules."""

        values = list(reversed(self.alert_rules.values()))
        return values[offset : offset + limit], len(values)

    async def list_enabled_alert_rules(self) -> list[AlertRule]:
        """Return enabled alert rules."""

        return [rule for rule in self.alert_rules.values() if rule.enabled]

    async def get_alert_rule(self, rule_id: str) -> AlertRule | None:
        """Return an alert rule by id."""

        return self.alert_rules.get(rule_id)

    async def update_alert_rule(self, rule: AlertRule) -> AlertRule:
        """Persist updated alert rule fields."""

        async with self._lock:
            self.alert_rules[rule.id] = rule
        return rule

    async def delete_alert_rule(self, rule_id: str) -> None:
        """Delete an alert rule."""

        async with self._lock:
            self.alert_rules.pop(rule_id, None)

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

    async def list_engagements(self, limit: int, offset: int) -> tuple[list[Engagement], int]:
        """List engagements."""

        values = sorted(
            self.engagements.values(),
            key=lambda engagement: engagement.started_at,
            reverse=True,
        )
        return values[offset : offset + limit], len(values)

    async def get_engagement(self, engagement_id: str) -> Engagement | None:
        """Return an engagement by id."""

        return self.engagements.get(engagement_id)

    async def get_active_engagement(self) -> Engagement | None:
        """Return the active engagement when one exists."""

        return next(
            (engagement for engagement in self.engagements.values() if engagement.ended_at is None),
            None,
        )

    async def update_engagement(self, engagement: Engagement) -> Engagement:
        """Persist updated engagement fields."""

        async with self._lock:
            self.engagements[engagement.id] = engagement
        return engagement

    async def allow_target(self, engagement_id: str, kind: TargetKind, value: str) -> None:
        """Allow a target for an engagement."""

        self.allow_list.add((engagement_id, kind, value.upper()))

    async def list_allowed_targets(
        self,
        engagement_id: str,
        limit: int,
        offset: int,
    ) -> tuple[list[AllowedTarget], int]:
        """List allowed targets for an engagement."""

        values = sorted(
            [
                AllowedTarget(kind=kind, value=value)
                for item_engagement_id, kind, value in self.allow_list
                if item_engagement_id == engagement_id
            ],
            key=lambda target: (target.kind.value, target.value),
        )
        return values[offset : offset + limit], len(values)

    async def remove_allowed_target(self, engagement_id: str, kind: TargetKind, value: str) -> None:
        """Remove an allowed target from an engagement."""

        self.allow_list.discard((engagement_id, kind, value.upper()))

    async def target_allowed(self, engagement_id: str, kind: TargetKind, value: str) -> bool:
        """Return whether a target is allowed."""

        return (engagement_id, kind, value.upper()) in self.allow_list

    async def create_report(self, report: ReportRecord) -> ReportRecord:
        """Persist a report request."""

        async with self._lock:
            self.reports[report.id] = report
        return report

    async def get_report(self, engagement_id: str, report_id: str) -> ReportRecord | None:
        """Return a report by engagement and id."""

        report = self.reports.get(report_id)
        if report is None or report.engagement_id != engagement_id:
            return None
        return report

    async def get_report_by_id(self, report_id: str) -> ReportRecord | None:
        """Return a report by id."""

        return self.reports.get(report_id)

    async def update_report(self, report: ReportRecord) -> ReportRecord:
        """Persist updated report fields."""

        async with self._lock:
            self.reports[report.id] = report
        return report


def _filter_alerts(
    alerts: list[Alert],
    severities: list[AlertSeverity] | None,
    acked: bool | None,
) -> list[Alert]:
    severity_set = set(severities or [])
    return [
        alert
        for alert in alerts
        if (not severity_set or alert.severity in severity_set)
        and (acked is None or (alert.acked_at is not None) == acked)
    ]
