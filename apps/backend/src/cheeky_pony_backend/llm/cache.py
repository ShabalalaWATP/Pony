# SPDX-License-Identifier: AGPL-3.0-only
"""Insight cache persistence."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Protocol

from motor.motor_asyncio import AsyncIOMotorDatabase

from cheeky_pony_backend.llm.types import CachedInsight, Insight, InsightKind


class InsightCache(Protocol):
    """Persistence boundary for cached LLM insights."""

    async def ensure_indexes(self) -> None:
        """Create backing indexes."""

    async def get(self, key: str) -> CachedInsight | None:
        """Return a cache record when present and unexpired."""

    async def set(self, record: CachedInsight) -> None:
        """Persist a cache record."""


class InMemoryInsightCache:
    """In-memory insight cache for tests and local no-database execution."""

    def __init__(self) -> None:
        self.records: dict[str, CachedInsight] = {}

    async def ensure_indexes(self) -> None:
        """No-op for in-memory storage."""

    async def get(self, key: str) -> CachedInsight | None:
        """Return an unexpired in-memory cache record."""

        record = self.records.get(key)
        if record is None or _is_expired(record):
            return None
        return record

    async def set(self, record: CachedInsight) -> None:
        """Persist an in-memory cache record."""

        self.records[record.key] = record


class MongoInsightCache:
    """Mongo-backed insight cache."""

    def __init__(self, db: AsyncIOMotorDatabase[dict[str, object]]) -> None:
        self._db = db

    async def ensure_indexes(self) -> None:
        """Create cache indexes."""

        await self._db.llm_insight_cache.create_index("key", unique=True)
        await self._db.llm_insight_cache.create_index("expires_at")

    async def get(self, key: str) -> CachedInsight | None:
        """Return an unexpired Mongo cache record."""

        doc = await self._db.llm_insight_cache.find_one({"key": key}, {"_id": False})
        if doc is None:
            return None
        record = CachedInsight.model_validate(doc)
        return None if _is_expired(record) else record

    async def set(self, record: CachedInsight) -> None:
        """Upsert a Mongo cache record."""

        await self._db.llm_insight_cache.replace_one(
            {"key": record.key},
            record.model_dump(mode="json"),
            upsert=True,
        )


def cache_key(
    *,
    kind: InsightKind,
    entity_id: str,
    prompt_hash: str,
    template_version: str,
) -> str:
    """Build the stable cache key mandated by ADR-0020."""

    return f"{kind}:{entity_id}:{template_version}:{prompt_hash}"


def cache_record(
    *,
    key: str,
    kind: InsightKind,
    entity_id: str,
    prompt_hash: str,
    template_version: str,
    insight: Insight,
    expires_at: datetime | None,
) -> CachedInsight:
    """Create one validated cache record."""

    return CachedInsight(
        key=key,
        kind=kind,
        entity_id=entity_id,
        prompt_hash=prompt_hash,
        template_version=template_version,
        insight=insight,
        expires_at=expires_at,
    )


def _is_expired(record: CachedInsight) -> bool:
    return record.expires_at is not None and record.expires_at <= datetime.now(tz=UTC)
