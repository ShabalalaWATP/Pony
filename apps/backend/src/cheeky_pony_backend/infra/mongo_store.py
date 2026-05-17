# SPDX-License-Identifier: AGPL-3.0-only
"""Motor-backed MongoDB store for production and compose deployments."""

from __future__ import annotations

from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from cheeky_pony_backend.domain.reports import ReportRecord
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_shared import (
    AccessPoint,
    Alert,
    AlertRule,
    AlertSeverity,
    AuditLog,
    Client,
    Engagement,
    Event,
    Sensor,
    SystemAcknowledgement,
    TargetKind,
)


class MongoStore:
    """MongoDB implementation of the application store."""

    def __init__(self, dsn: str, database_name: str) -> None:
        self.client: AsyncIOMotorClient[dict[str, Any]] = AsyncIOMotorClient(dsn)
        self.db: AsyncIOMotorDatabase[dict[str, Any]] = self.client[database_name]

    async def ensure_indexes(self) -> None:
        """Create datastore indices."""

        await self.db.events.create_index([("sensor_id", 1), ("occurred_at", -1)])
        await self.db.access_points.create_index("bssid", unique=True)
        await self.db.clients.create_index("mac", unique=True)
        await self.db.clients.create_index([("associated_bssid", 1), ("last_seen", -1)])
        await self.db.alerts.create_index([("severity", 1), ("acked_at", 1)])
        await self.db.alert_rules.create_index("enabled")
        await self.db.audit_logs.create_index("occurred_at")
        await self.db.allow_list.create_index(
            [("engagement_id", 1), ("kind", 1), ("value", 1)],
            unique=True,
        )
        await self.db.reports.create_index([("engagement_id", 1), ("id", 1)], unique=True)

    async def count_users(self) -> int:
        """Return the number of users."""

        return await self.db.users.count_documents({})

    async def create_user(self, user: UserRecord) -> UserRecord:
        """Persist a user."""

        await self.db.users.insert_one(user.model_dump(mode="json"))
        return user

    async def get_user_by_email(self, email: str) -> UserRecord | None:
        """Look up a user by email."""

        data = await self.db.users.find_one({"email": email})
        return UserRecord.model_validate(data) if data else None

    async def get_user(self, user_id: str) -> UserRecord | None:
        """Look up a user by id."""

        data = await self.db.users.find_one({"id": user_id})
        return UserRecord.model_validate(data) if data else None

    async def update_user(self, user: UserRecord) -> UserRecord:
        """Persist updated user fields."""

        await self.db.users.replace_one({"id": user.id}, user.model_dump(mode="json"), upsert=True)
        return user

    async def create_sensor(self, sensor: Sensor) -> Sensor:
        """Persist a sensor."""

        await self.db.sensors.insert_one(sensor.model_dump(mode="json"))
        return sensor

    async def list_sensors(self) -> list[Sensor]:
        """Return all sensors."""

        docs = self.db.sensors.find({})
        return [Sensor.model_validate(doc) async for doc in docs]

    async def get_sensor(self, sensor_id: str) -> Sensor | None:
        """Return a sensor by id."""

        data = await self.db.sensors.find_one({"id": sensor_id})
        return Sensor.model_validate(data) if data else None

    async def revoke_sensor(self, sensor_id: str) -> None:
        """Mark a sensor as revoked."""

        await self.db.sensors.update_one({"id": sensor_id}, {"$set": {"revoked": True}})

    async def update_sensor(self, sensor: Sensor) -> Sensor:
        """Persist updated sensor fields."""

        await self.db.sensors.replace_one(
            {"id": sensor.id},
            sensor.model_dump(mode="json"),
            upsert=True,
        )
        return sensor

    async def upsert_access_point(self, access_point: AccessPoint) -> AccessPoint:
        """Upsert an access point."""

        await self.db.access_points.replace_one(
            {"bssid": access_point.bssid},
            access_point.model_dump(mode="json"),
            upsert=True,
        )
        return access_point

    async def upsert_client(self, client: Client) -> Client:
        """Upsert a client device."""

        await self.db.clients.replace_one(
            {"mac": client.mac},
            client.model_dump(mode="json"),
            upsert=True,
        )
        return client

    async def insert_event(self, event: Event) -> Event:
        """Append an event."""

        await self.db.events.insert_one(event.model_dump(mode="json"))
        return event

    async def list_access_points(self, limit: int, offset: int) -> tuple[list[AccessPoint], int]:
        """List access points."""

        total = await self.db.access_points.count_documents({})
        docs = self.db.access_points.find({}).skip(offset).limit(limit)
        return [AccessPoint.model_validate(doc) async for doc in docs], total

    async def get_access_point(self, bssid: str) -> AccessPoint | None:
        """Return an access point by BSSID."""

        data = await self.db.access_points.find_one({"bssid": bssid.upper()})
        return AccessPoint.model_validate(data) if data else None

    async def list_clients(self, limit: int, offset: int) -> tuple[list[Client], int]:
        """List client devices."""

        total = await self.db.clients.count_documents({})
        docs = self.db.clients.find({}).skip(offset).limit(limit)
        return [Client.model_validate(doc) async for doc in docs], total

    async def list_clients_for_access_point(
        self,
        bssid: str,
        limit: int,
        offset: int,
    ) -> tuple[list[Client], int]:
        """List client devices associated to an access point."""

        query = {"associated_bssid": bssid.upper()}
        total = await self.db.clients.count_documents(query)
        docs = self.db.clients.find(query).sort("last_seen", -1).skip(offset).limit(limit)
        return [Client.model_validate(doc) async for doc in docs], total

    async def get_client(self, mac: str) -> Client | None:
        """Return a client by MAC."""

        data = await self.db.clients.find_one({"mac": mac.upper()})
        return Client.model_validate(data) if data else None

    async def list_events(self, limit: int, offset: int) -> tuple[list[Event], int]:
        """List events."""

        total = await self.db.events.count_documents({})
        docs = self.db.events.find({}).sort("occurred_at", -1).skip(offset).limit(limit)
        return [Event.model_validate(doc) async for doc in docs], total

    async def get_event(self, event_id: str) -> Event | None:
        """Return an event by id."""

        data = await self.db.events.find_one({"id": event_id})
        return Event.model_validate(data) if data else None

    async def insert_alert(self, alert: Alert) -> Alert:
        """Persist an alert."""

        await self.db.alerts.insert_one(alert.model_dump(mode="json"))
        return alert

    async def list_alerts(
        self,
        limit: int,
        offset: int,
        severities: list[AlertSeverity] | None,
        acked: bool | None,
    ) -> tuple[list[Alert], int]:
        """List alerts."""

        query = _alert_query(severities, acked)
        total = await self.db.alerts.count_documents(query)
        docs = self.db.alerts.find(query, {"_id": False}).sort("_id", -1).skip(offset).limit(limit)
        return [Alert.model_validate(doc) async for doc in docs], total

    async def get_alert(self, alert_id: str) -> Alert | None:
        """Return an alert by id."""

        data = await self.db.alerts.find_one({"id": alert_id}, {"_id": False})
        return Alert.model_validate(data) if data else None

    async def update_alert(self, alert: Alert) -> Alert:
        """Persist updated alert fields."""

        await self.db.alerts.replace_one(
            {"id": alert.id},
            alert.model_dump(mode="json"),
            upsert=True,
        )
        return alert

    async def create_alert_rule(self, rule: AlertRule) -> AlertRule:
        """Persist an alert rule."""

        await self.db.alert_rules.insert_one(rule.model_dump(mode="json"))
        return rule

    async def list_alert_rules(self, limit: int, offset: int) -> tuple[list[AlertRule], int]:
        """List alert rules."""

        total = await self.db.alert_rules.count_documents({})
        docs = (
            self.db.alert_rules.find({}, {"_id": False}).sort("_id", -1).skip(offset).limit(limit)
        )
        return [AlertRule.model_validate(doc) async for doc in docs], total

    async def list_enabled_alert_rules(self) -> list[AlertRule]:
        """Return enabled alert rules."""

        docs = self.db.alert_rules.find({"enabled": True}, {"_id": False})
        return [AlertRule.model_validate(doc) async for doc in docs]

    async def get_alert_rule(self, rule_id: str) -> AlertRule | None:
        """Return an alert rule by id."""

        data = await self.db.alert_rules.find_one({"id": rule_id}, {"_id": False})
        return AlertRule.model_validate(data) if data else None

    async def update_alert_rule(self, rule: AlertRule) -> AlertRule:
        """Persist updated alert rule fields."""

        await self.db.alert_rules.replace_one(
            {"id": rule.id},
            rule.model_dump(mode="json"),
            upsert=True,
        )
        return rule

    async def delete_alert_rule(self, rule_id: str) -> None:
        """Delete an alert rule."""

        await self.db.alert_rules.delete_one({"id": rule_id})

    async def append_audit(self, audit_log: AuditLog) -> AuditLog:
        """Append an audit log."""

        await self.db.audit_logs.insert_one(audit_log.model_dump(mode="json"))
        return audit_log

    async def list_audit(self, limit: int, offset: int) -> tuple[list[AuditLog], int]:
        """List audit logs."""

        total = await self.db.audit_logs.count_documents({})
        docs = self.db.audit_logs.find({}).sort("occurred_at", -1).skip(offset).limit(limit)
        return [AuditLog.model_validate(doc) async for doc in docs], total

    async def create_acknowledgement(self, acknowledgement: SystemAcknowledgement) -> None:
        """Persist an acknowledgement."""

        await self.db.system_acknowledgements.replace_one(
            {"kind": acknowledgement.kind},
            acknowledgement.model_dump(mode="json"),
            upsert=True,
        )

    async def has_acknowledgement(self, kind: str) -> bool:
        """Return whether an acknowledgement exists."""

        return await self.db.system_acknowledgements.count_documents({"kind": kind}) > 0

    async def create_engagement(self, engagement: Engagement) -> Engagement:
        """Persist an engagement."""

        await self.db.engagements.insert_one(engagement.model_dump(mode="json"))
        return engagement

    async def get_engagement(self, engagement_id: str) -> Engagement | None:
        """Return an engagement by id."""

        data = await self.db.engagements.find_one({"id": engagement_id}, {"_id": False})
        return Engagement.model_validate(data) if data else None

    async def get_active_engagement(self) -> Engagement | None:
        """Return the active engagement when one exists."""

        data = await self.db.engagements.find_one({"ended_at": None}, {"_id": False})
        return Engagement.model_validate(data) if data else None

    async def update_engagement(self, engagement: Engagement) -> Engagement:
        """Persist updated engagement fields."""

        await self.db.engagements.replace_one(
            {"id": engagement.id},
            engagement.model_dump(mode="json"),
            upsert=True,
        )
        return engagement

    async def allow_target(self, engagement_id: str, kind: TargetKind, value: str) -> None:
        """Allow a target for an engagement."""

        await self.db.allow_list.update_one(
            {"engagement_id": engagement_id, "kind": kind.value, "value": value.upper()},
            {"$set": {"engagement_id": engagement_id, "kind": kind.value, "value": value.upper()}},
            upsert=True,
        )

    async def target_allowed(self, engagement_id: str, kind: TargetKind, value: str) -> bool:
        """Return whether a target is allowed."""

        return (
            await self.db.allow_list.count_documents(
                {"engagement_id": engagement_id, "kind": kind.value, "value": value.upper()}
            )
            > 0
        )

    async def create_report(self, report: ReportRecord) -> ReportRecord:
        """Persist a report request."""

        await self.db.reports.insert_one(report.model_dump(mode="json"))
        return report

    async def get_report(self, engagement_id: str, report_id: str) -> ReportRecord | None:
        """Return a report by engagement and id."""

        data = await self.db.reports.find_one(
            {"engagement_id": engagement_id, "id": report_id},
            {"_id": False},
        )
        return ReportRecord.model_validate(data) if data else None

    async def get_report_by_id(self, report_id: str) -> ReportRecord | None:
        """Return a report by id."""

        data = await self.db.reports.find_one({"id": report_id}, {"_id": False})
        return ReportRecord.model_validate(data) if data else None

    async def update_report(self, report: ReportRecord) -> ReportRecord:
        """Persist updated report fields."""

        await self.db.reports.replace_one(
            {"id": report.id},
            report.model_dump(mode="json"),
            upsert=True,
        )
        return report


def _alert_query(
    severities: list[AlertSeverity] | None,
    acked: bool | None,
) -> dict[str, Any]:
    query: dict[str, Any] = {}
    if severities:
        query["severity"] = {"$in": [severity.value for severity in severities]}
    if acked is True:
        query["acked_at"] = {"$ne": None}
    elif acked is False:
        query["acked_at"] = None
    return query
