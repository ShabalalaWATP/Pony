# SPDX-License-Identifier: AGPL-3.0-only
"""Motor-backed MongoDB store for production and compose deployments."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from cheeky_pony_backend.domain.reports import ReportRecord
from cheeky_pony_backend.infra.mongo_engagements import MongoEngagementStoreMixin
from cheeky_pony_backend.infra.mongo_users import MongoUserStoreMixin
from cheeky_pony_backend.infra.signals_repo import MongoSignalsRepo, SignalsRepo
from cheeky_pony_shared import (
    AccessPoint,
    Alert,
    AlertRule,
    AlertSeverity,
    AuditLog,
    Client,
    Event,
    Sensor,
    SystemAcknowledgement,
)

SYNTHETIC_COUNT_COLLECTIONS = (
    "sensors",
    "access_points",
    "clients",
    "events",
    "alerts",
    "alert_rules",
    "engagements",
    "allow_list",
)


class MongoStore(MongoUserStoreMixin, MongoEngagementStoreMixin):
    """MongoDB implementation of the application store."""

    def __init__(self, dsn: str, database_name: str) -> None:
        self.client: AsyncIOMotorClient[dict[str, Any]] = AsyncIOMotorClient(dsn)
        self.db: AsyncIOMotorDatabase[dict[str, Any]] = self.client[database_name]
        self.signals_repo: SignalsRepo = MongoSignalsRepo(self.db)

    async def ensure_indexes(self) -> None:
        """Create datastore indices."""

        await self.db.events.create_index([("sensor_id", 1), ("occurred_at", -1)])
        await self.db.access_points.create_index("bssid", unique=True)
        await self.db.clients.create_index("mac", unique=True)
        await self.db.clients.create_index([("associated_bssid", 1), ("last_seen", -1)])
        await self.db.alerts.create_index([("severity", 1), ("acked_at", 1)])
        await self.db.alert_rules.create_index("enabled")
        await self.db.audit_logs.create_index("occurred_at")
        await self.db.users.create_index("email", unique=True)
        await self.db.users.create_index([("created_at", 1), ("email", 1)])
        await self.db.allow_list.create_index(
            [("engagement_id", 1), ("kind", 1), ("value", 1)],
            unique=True,
        )
        await self.db.reports.create_index([("engagement_id", 1), ("id", 1)], unique=True)

    async def create_sensor(self, sensor: Sensor) -> Sensor:
        """Persist a sensor."""

        await self.db.sensors.insert_one(sensor.model_dump(mode="json"))
        return sensor

    async def list_sensors(self) -> list[Sensor]:
        """Return all sensors."""

        docs = self.db.sensors.find({}, {"_id": False})
        return [Sensor.model_validate(doc) async for doc in docs]

    async def get_sensor(self, sensor_id: str) -> Sensor | None:
        """Return a sensor by id."""

        data = await self.db.sensors.find_one({"id": sensor_id}, {"_id": False})
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

        samples = list(access_point.signal_history)
        payload = access_point.model_dump(mode="json")
        payload["bssid"] = access_point.bssid.upper()
        payload.pop("signal_history", None)
        await self.db.access_points.update_one(
            {"bssid": access_point.bssid.upper()},
            {"$set": payload, "$setOnInsert": {"signal_history": []}},
            upsert=True,
        )
        signal_history = await self.signals_repo.recent_ap_samples(access_point.bssid)
        for sample in samples:
            signal_history = await self.signals_repo.append_ap_sample(access_point.bssid, sample)
        return access_point.model_copy(
            update={"bssid": access_point.bssid.upper(), "signal_history": signal_history}
        )

    async def upsert_client(self, client: Client) -> Client:
        """Upsert a client device."""

        samples = list(client.signal_history)
        payload = client.model_dump(mode="json")
        payload["mac"] = client.mac.upper()
        if client.associated_bssid is not None:
            payload["associated_bssid"] = client.associated_bssid.upper()
        payload.pop("signal_history", None)
        await self.db.clients.update_one(
            {"mac": client.mac.upper()},
            {"$set": payload, "$setOnInsert": {"signal_history": []}},
            upsert=True,
        )
        signal_history = await self.signals_repo.recent_client_samples(client.mac)
        for sample in samples:
            signal_history = await self.signals_repo.append_client_sample(client.mac, sample)
        return client.model_copy(
            update={"mac": client.mac.upper(), "signal_history": signal_history}
        )

    async def insert_event(self, event: Event) -> Event:
        """Append an event."""

        await self.db.events.insert_one(event.model_dump(mode="json"))
        return event

    async def list_access_points(self, limit: int, offset: int) -> tuple[list[AccessPoint], int]:
        """List access points."""

        total = await self.db.access_points.count_documents({})
        docs = self.db.access_points.find({}, {"_id": False}).skip(offset).limit(limit)
        return [AccessPoint.model_validate(doc) async for doc in docs], total

    async def get_access_point(self, bssid: str) -> AccessPoint | None:
        """Return an access point by BSSID."""

        data = await self.db.access_points.find_one({"bssid": bssid.upper()}, {"_id": False})
        return AccessPoint.model_validate(data) if data else None

    async def list_clients(self, limit: int, offset: int) -> tuple[list[Client], int]:
        """List client devices."""

        total = await self.db.clients.count_documents({})
        docs = self.db.clients.find({}, {"_id": False}).skip(offset).limit(limit)
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
        docs = (
            self.db.clients.find(query, {"_id": False})
            .sort("last_seen", -1)
            .skip(offset)
            .limit(limit)
        )
        return [Client.model_validate(doc) async for doc in docs], total

    async def get_client(self, mac: str) -> Client | None:
        """Return a client by MAC."""

        data = await self.db.clients.find_one({"mac": mac.upper()}, {"_id": False})
        return Client.model_validate(data) if data else None

    async def list_events(self, limit: int, offset: int) -> tuple[list[Event], int]:
        """List events."""

        total = await self.db.events.count_documents({})
        docs = (
            self.db.events.find({}, {"_id": False})
            .sort("occurred_at", -1)
            .skip(offset)
            .limit(limit)
        )
        return [Event.model_validate(doc) async for doc in docs], total

    async def get_event(self, event_id: str) -> Event | None:
        """Return an event by id."""

        data = await self.db.events.find_one({"id": event_id}, {"_id": False})
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
        docs = (
            self.db.audit_logs.find({}, {"_id": False})
            .sort("occurred_at", -1)
            .skip(offset)
            .limit(limit)
        )
        return [AuditLog.model_validate(doc) async for doc in docs], total

    async def count_synthetic_records(self) -> int:
        """Count seeded demo records across telemetry collections."""

        total = 0
        for collection_name in SYNTHETIC_COUNT_COLLECTIONS:
            total += await self.db[collection_name].count_documents({"synthetic": True})
        return total

    async def last_demo_seeded_at(self) -> datetime | None:
        """Return the latest successful demo seed timestamp."""

        data = await self.db.audit_logs.find_one(
            {"action": "demo.seed.run"},
            {"_id": False},
            sort=[("occurred_at", -1)],
        )
        return AuditLog.model_validate(data).occurred_at if data else None

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
