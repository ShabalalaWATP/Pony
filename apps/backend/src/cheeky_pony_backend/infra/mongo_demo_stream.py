# SPDX-License-Identifier: AGPL-3.0-only
"""MongoDB demo stream queue persistence."""

from __future__ import annotations

from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from cheeky_pony_backend.infra.demo_stream import DemoStreamRecord

DEMO_STREAM_COLLECTION = "demo_stream_records"
DEMO_STREAM_TTL_SECONDS = 300


class MongoDemoStreamStoreMixin:
    """Mongo-backed demo stream queue operations."""

    db: AsyncIOMotorDatabase[dict[str, Any]]

    async def ensure_demo_stream_indexes(self) -> None:
        """Create demo stream queue indexes."""

        await self.db[DEMO_STREAM_COLLECTION].create_index("id", unique=True)
        await self.db[DEMO_STREAM_COLLECTION].create_index(
            "created_at",
            expireAfterSeconds=DEMO_STREAM_TTL_SECONDS,
        )

    async def enqueue_demo_stream_record(self, record: DemoStreamRecord) -> DemoStreamRecord:
        """Queue one synthetic demo stream record."""

        await self.db[DEMO_STREAM_COLLECTION].replace_one(
            {"id": record.id},
            record.model_dump(mode="json"),
            upsert=True,
        )
        return record

    async def pending_demo_stream_records(self, limit: int) -> list[DemoStreamRecord]:
        """Return queued demo stream records in insertion order."""

        docs = (
            self.db[DEMO_STREAM_COLLECTION]
            .find({"synthetic": True}, {"_id": False})
            .sort([("created_at", 1), ("id", 1)])
            .limit(limit)
        )
        return [DemoStreamRecord.model_validate(doc) async for doc in docs]

    async def delete_demo_stream_record(self, record_id: str) -> None:
        """Delete one queued demo stream record."""

        await self.db[DEMO_STREAM_COLLECTION].delete_one({"id": record_id})
