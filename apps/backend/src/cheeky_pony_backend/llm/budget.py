# SPDX-License-Identifier: AGPL-3.0-only
"""Monthly LLM usage ledger and budget enforcement."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Protocol

from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ReturnDocument


class UsageLedger(Protocol):
    """Persistence boundary for monthly LLM spend accounting."""

    async def ensure_indexes(self) -> None:
        """Create backing indexes."""

    async def reserve_monthly_budget(self, month: str, amount: int, budget: int) -> bool:
        """Atomically reserve spend when it stays within budget."""

    async def adjust_monthly_spend(self, month: str, amount_delta: int) -> None:
        """Adjust spend after actual token usage is known."""

    async def current_month_spend(self, month: str) -> int:
        """Return current recorded spend."""


class InMemoryUsageLedger:
    """In-memory ledger for tests and local no-database execution."""

    def __init__(self) -> None:
        self.spend_by_month: dict[str, int] = {}

    async def ensure_indexes(self) -> None:
        """No-op for in-memory storage."""

    async def reserve_monthly_budget(self, month: str, amount: int, budget: int) -> bool:
        """Reserve spend when the budget allows it."""

        current = self.spend_by_month.get(month, 0)
        if budget > 0 and current + amount > budget:
            return False
        self.spend_by_month[month] = current + amount
        return True

    async def adjust_monthly_spend(self, month: str, amount_delta: int) -> None:
        """Apply a spend adjustment."""

        current = self.spend_by_month.get(month, 0)
        self.spend_by_month[month] = max(0, current + amount_delta)

    async def current_month_spend(self, month: str) -> int:
        """Return in-memory spend."""

        return self.spend_by_month.get(month, 0)


class MongoUsageLedger:
    """Mongo-backed monthly LLM usage ledger."""

    def __init__(self, db: AsyncIOMotorDatabase[dict[str, object]]) -> None:
        self._db = db

    async def ensure_indexes(self) -> None:
        """Create ledger indexes."""

        await self._db.llm_usage_ledger.create_index("month", unique=True)

    async def reserve_monthly_budget(self, month: str, amount: int, budget: int) -> bool:
        """Atomically reserve spend when the resulting total fits the budget."""

        if budget <= 0:
            await self.adjust_monthly_spend(month, amount)
            return True
        if amount > budget:
            return False
        now = datetime.now(tz=UTC)
        await self._db.llm_usage_ledger.update_one(
            {"month": month},
            {
                "$setOnInsert": {
                    "month": month,
                    "spend_micro_cents": 0,
                    "created_at": now,
                },
                "$set": {"updated_at": now},
            },
            upsert=True,
        )
        doc = await self._db.llm_usage_ledger.find_one_and_update(
            {"month": month, "spend_micro_cents": {"$lte": budget - amount}},
            {
                "$inc": {"spend_micro_cents": amount},
                "$set": {"updated_at": datetime.now(tz=UTC)},
            },
            return_document=ReturnDocument.AFTER,
        )
        return doc is not None

    async def adjust_monthly_spend(self, month: str, amount_delta: int) -> None:
        """Apply a spend adjustment."""

        await self._db.llm_usage_ledger.update_one(
            {"month": month},
            {
                "$inc": {"spend_micro_cents": amount_delta},
                "$setOnInsert": {"month": month, "created_at": datetime.now(tz=UTC)},
                "$set": {"updated_at": datetime.now(tz=UTC)},
            },
            upsert=True,
        )

    async def current_month_spend(self, month: str) -> int:
        """Return Mongo-recorded spend for a month."""

        doc = await self._db.llm_usage_ledger.find_one({"month": month}, {"_id": False})
        if doc is None:
            return 0
        spend = doc.get("spend_micro_cents")
        return spend if isinstance(spend, int) else 0


def current_budget_month() -> str:
    """Return the UTC month key for LLM spend accounting."""

    return datetime.now(tz=UTC).strftime("%Y-%m")
