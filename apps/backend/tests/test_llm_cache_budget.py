# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for LLM cache and budget ledger behavior."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from cheeky_pony_backend.llm.budget import InMemoryUsageLedger, MongoUsageLedger
from cheeky_pony_backend.llm.cache import (
    InMemoryInsightCache,
    MongoInsightCache,
    cache_key,
    cache_record,
)
from cheeky_pony_backend.llm.types import Insight

pytestmark = pytest.mark.asyncio


async def test_cache_returns_unexpired_records_and_skips_expired() -> None:
    """Cache records are keyed by prompt and ignored after expiry."""

    cache = InMemoryInsightCache()
    insight = _insight("alert-1")
    key = cache_key(
        kind="alert_context",
        entity_id="alert-1",
        prompt_hash="sha256:" + "a" * 64,
        template_version="v1",
    )
    await cache.set(
        cache_record(
            key=key,
            kind="alert_context",
            entity_id="alert-1",
            prompt_hash="sha256:" + "a" * 64,
            template_version="v1",
            insight=insight,
            expires_at=None,
        )
    )
    assert await cache.get(key) is not None

    expired_key = key.replace("alert-1", "alert-2")
    await cache.set(
        cache_record(
            key=expired_key,
            kind="alert_context",
            entity_id="alert-2",
            prompt_hash="sha256:" + "b" * 64,
            template_version="v1",
            insight=_insight("alert-2"),
            expires_at=datetime.now(tz=UTC) - timedelta(seconds=1),
        )
    )
    assert await cache.get(expired_key) is None


async def test_template_version_participates_in_cache_key() -> None:
    """Changing template version invalidates the prompt cache."""

    first = cache_key(
        kind="alert_context",
        entity_id="alert-1",
        prompt_hash="sha256:" + "a" * 64,
        template_version="v1",
    )
    second = cache_key(
        kind="alert_context",
        entity_id="alert-1",
        prompt_hash="sha256:" + "a" * 64,
        template_version="v2",
    )

    assert first != second


async def test_budget_ledger_enforces_monthly_cap() -> None:
    """The ledger refuses reservations that exceed the configured cap."""

    ledger = InMemoryUsageLedger()

    assert await ledger.reserve_monthly_budget("2026-05", 50, 100)
    assert not await ledger.reserve_monthly_budget("2026-05", 60, 100)
    assert await ledger.current_month_spend("2026-05") == 50
    await ledger.adjust_monthly_spend("2026-05", -20)
    assert await ledger.current_month_spend("2026-05") == 30


async def test_mongo_cache_adapter_round_trips_and_expires() -> None:
    """Mongo cache adapter behavior is covered without a real server."""

    db = _FakeDb()
    cache = MongoInsightCache(db)  # type: ignore[arg-type]
    key = cache_key(
        kind="alert_context",
        entity_id="alert-1",
        prompt_hash="sha256:" + "a" * 64,
        template_version="v1",
    )
    await cache.ensure_indexes()
    await cache.set(
        cache_record(
            key=key,
            kind="alert_context",
            entity_id="alert-1",
            prompt_hash="sha256:" + "a" * 64,
            template_version="v1",
            insight=_insight("alert-1"),
            expires_at=None,
        )
    )

    assert await cache.get(key) is not None
    db.llm_insight_cache.docs[key]["expires_at"] = datetime.now(tz=UTC) - timedelta(seconds=1)
    assert await cache.get(key) is None


async def test_mongo_usage_ledger_reserves_adjusts_and_caps() -> None:
    """Mongo ledger adapter applies the same budget semantics atomically."""

    db = _FakeDb()
    ledger = MongoUsageLedger(db)  # type: ignore[arg-type]

    await ledger.ensure_indexes()
    assert await ledger.reserve_monthly_budget("2026-05", 40, 100)
    assert await ledger.current_month_spend("2026-05") == 40
    assert not await ledger.reserve_monthly_budget("2026-05", 70, 100)
    await ledger.adjust_monthly_spend("2026-05", -10)
    assert await ledger.current_month_spend("2026-05") == 30


def _insight(entity_id: str) -> Insight:
    return Insight(
        kind="alert_context",
        entity_id=entity_id,
        summary="Summary",
        bullet_points=["Point"],
        confidence="medium",
        generated_at=datetime.now(tz=UTC),
        model="gpt-4o-mini",
        template_version="v1",
    )


class _FakeDb:
    def __init__(self) -> None:
        self.llm_insight_cache = _FakeInsightCollection()
        self.llm_usage_ledger = _FakeLedgerCollection()


class _FakeInsightCollection:
    def __init__(self) -> None:
        self.docs: dict[str, dict[str, object]] = {}

    async def create_index(self, _: str, unique: bool = False) -> None:
        self.unique = unique

    async def find_one(
        self, query: dict[str, object], projection: dict[str, bool]
    ) -> dict[str, object] | None:
        del projection
        key = query.get("key")
        return self.docs.get(str(key))

    async def replace_one(
        self,
        query: dict[str, object],
        doc: dict[str, object],
        upsert: bool,
    ) -> None:
        del upsert
        self.docs[str(query["key"])] = dict(doc)


class _FakeLedgerCollection:
    def __init__(self) -> None:
        self.docs: dict[str, dict[str, object]] = {}

    async def create_index(self, _: str, unique: bool = False) -> None:
        self.unique = unique

    async def update_one(
        self,
        query: dict[str, object],
        update: dict[str, dict[str, object]],
        upsert: bool,
    ) -> None:
        month = str(query["month"])
        if upsert and month not in self.docs:
            self.docs[month] = {"month": month, "spend_micro_cents": 0}
        _apply_update(self.docs[month], update)

    async def find_one_and_update(
        self,
        query: dict[str, object],
        update: dict[str, dict[str, object]],
        return_document: object,
    ) -> dict[str, object] | None:
        del return_document
        month = str(query["month"])
        doc = self.docs.get(month)
        cap = query.get("spend_micro_cents")
        if doc is None or not _matches_lte(doc, cap):
            return None
        _apply_update(doc, update)
        return dict(doc)

    async def find_one(
        self,
        query: dict[str, object],
        projection: dict[str, bool],
    ) -> dict[str, object] | None:
        del projection
        doc = self.docs.get(str(query["month"]))
        return None if doc is None else dict(doc)


def _matches_lte(doc: dict[str, object], condition: object) -> bool:
    if not isinstance(condition, dict):
        return True
    limit = condition.get("$lte")
    spend = doc.get("spend_micro_cents")
    return isinstance(limit, int) and isinstance(spend, int) and spend <= limit


def _apply_update(doc: dict[str, object], update: dict[str, dict[str, object]]) -> None:
    for key, value in update.get("$setOnInsert", {}).items():
        doc.setdefault(key, value)
    for key, value in update.get("$set", {}).items():
        doc[key] = value
    for key, value in update.get("$inc", {}).items():
        current = doc.get(key, 0)
        if isinstance(current, int) and isinstance(value, int):
            doc[key] = current + value
