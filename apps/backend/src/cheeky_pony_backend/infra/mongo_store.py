# SPDX-License-Identifier: AGPL-3.0-only
"""Motor-backed MongoDB store for production and compose deployments."""

from __future__ import annotations

from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

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
        await self.db.audit_logs.create_index("occurred_at")
        await self.db.allow_list.create_index(
            [("engagement_id", 1), ("kind", 1), ("value", 1)],
            unique=True,
        )

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
