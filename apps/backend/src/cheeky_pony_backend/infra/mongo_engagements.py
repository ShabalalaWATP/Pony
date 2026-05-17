# SPDX-License-Identifier: AGPL-3.0-only
"""MongoDB engagement and allow-list persistence mixin."""

from __future__ import annotations

from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from cheeky_pony_shared import AllowedTarget, Engagement, TargetKind


class MongoEngagementStoreMixin:
    """Engagement persistence operations for Mongo-backed stores."""

    db: AsyncIOMotorDatabase[dict[str, Any]]

    async def create_engagement(self, engagement: Engagement) -> Engagement:
        """Persist an engagement.

        Args:
            engagement: Engagement to persist.

        Returns:
            Persisted engagement.
        """

        await self.db.engagements.insert_one(engagement.model_dump(mode="json"))
        return engagement

    async def list_engagements(self, limit: int, offset: int) -> tuple[list[Engagement], int]:
        """List engagements.

        Args:
            limit: Page size.
            offset: Page offset.

        Returns:
            Page of engagements and total count.
        """

        total = await self.db.engagements.count_documents({})
        docs = (
            self.db.engagements.find({}, {"_id": False})
            .sort("started_at", -1)
            .skip(offset)
            .limit(limit)
        )
        return [Engagement.model_validate(doc) async for doc in docs], total

    async def get_engagement(self, engagement_id: str) -> Engagement | None:
        """Return an engagement by id.

        Args:
            engagement_id: Engagement identifier.

        Returns:
            Engagement when found.
        """

        data = await self.db.engagements.find_one({"id": engagement_id}, {"_id": False})
        return Engagement.model_validate(data) if data else None

    async def get_active_engagement(self) -> Engagement | None:
        """Return the active engagement when one exists.

        Returns:
            Active engagement when found.
        """

        data = await self.db.engagements.find_one({"ended_at": None}, {"_id": False})
        return Engagement.model_validate(data) if data else None

    async def update_engagement(self, engagement: Engagement) -> Engagement:
        """Persist updated engagement fields.

        Args:
            engagement: Engagement to replace.

        Returns:
            Persisted engagement.
        """

        await self.db.engagements.replace_one(
            {"id": engagement.id},
            engagement.model_dump(mode="json"),
            upsert=True,
        )
        return engagement

    async def allow_target(self, engagement_id: str, kind: TargetKind, value: str) -> None:
        """Allow a target for an engagement.

        Args:
            engagement_id: Engagement identifier.
            kind: Target kind.
            value: Target value.
        """

        target = {"engagement_id": engagement_id, "kind": kind.value, "value": value.upper()}
        await self.db.allow_list.update_one(target, {"$set": target}, upsert=True)

    async def list_allowed_targets(
        self,
        engagement_id: str,
        limit: int,
        offset: int,
    ) -> tuple[list[AllowedTarget], int]:
        """List allowed targets for an engagement.

        Args:
            engagement_id: Engagement identifier.
            limit: Page size.
            offset: Page offset.

        Returns:
            Page of allowed targets and total count.
        """

        query = {"engagement_id": engagement_id}
        total = await self.db.allow_list.count_documents(query)
        docs = (
            self.db.allow_list.find(query, {"_id": False, "kind": True, "value": True})
            .sort([("kind", 1), ("value", 1)])
            .skip(offset)
            .limit(limit)
        )
        return [AllowedTarget.model_validate(doc) async for doc in docs], total

    async def remove_allowed_target(
        self,
        engagement_id: str,
        kind: TargetKind,
        value: str,
    ) -> None:
        """Remove an allowed target from an engagement.

        Args:
            engagement_id: Engagement identifier.
            kind: Target kind.
            value: Target value.
        """

        await self.db.allow_list.delete_one(
            {"engagement_id": engagement_id, "kind": kind.value, "value": value.upper()}
        )

    async def target_allowed(self, engagement_id: str, kind: TargetKind, value: str) -> bool:
        """Return whether a target is allowed.

        Args:
            engagement_id: Engagement identifier.
            kind: Target kind.
            value: Target value.

        Returns:
            True when the target is allowed.
        """

        return (
            await self.db.allow_list.count_documents(
                {"engagement_id": engagement_id, "kind": kind.value, "value": value.upper()}
            )
            > 0
        )
