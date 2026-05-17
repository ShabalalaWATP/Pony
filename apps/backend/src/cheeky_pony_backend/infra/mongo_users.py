# SPDX-License-Identifier: AGPL-3.0-only
"""MongoDB user persistence operations."""

from __future__ import annotations

from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.errors import OperationFailure

from cheeky_pony_backend.domain.users import LastAdminDemotionError, UserRecord


class MongoUserStoreMixin:
    """User persistence operations for Mongo-backed stores."""

    client: AsyncIOMotorClient[dict[str, Any]]
    db: AsyncIOMotorDatabase[dict[str, Any]]

    async def count_users(self) -> int:
        """Return the number of users."""

        return await self.db.users.count_documents({})

    async def create_user(self, user: UserRecord) -> UserRecord:
        """Persist a user."""

        await self.db.users.insert_one(user.model_dump(mode="json"))
        return user

    async def get_user_by_email(self, email: str) -> UserRecord | None:
        """Look up a user by email."""

        data = await self.db.users.find_one({"email": email}, {"_id": False})
        return UserRecord.model_validate(data) if data else None

    async def get_user(self, user_id: str) -> UserRecord | None:
        """Look up a user by id."""

        data = await self.db.users.find_one({"id": user_id}, {"_id": False})
        return UserRecord.model_validate(data) if data else None

    async def list_users(self, limit: int, offset: int) -> tuple[list[UserRecord], int]:
        """List users in stable order."""

        total = await self.db.users.count_documents({})
        docs = self.db.users.find({}, {"_id": False}).sort([("created_at", 1), ("email", 1)])
        docs = docs.skip(offset).limit(limit)
        return [UserRecord.model_validate(doc) async for doc in docs], total

    async def update_user(self, user: UserRecord) -> UserRecord:
        """Persist updated user fields."""

        await self.db.users.replace_one(
            {"id": user.id},
            user.model_dump(mode="json"),
            upsert=True,
        )
        return user

    async def update_user_access(
        self,
        user_id: str,
        roles: list[str] | None,
        reset_totp: bool,
        actor_id: str,
    ) -> UserRecord | None:
        """Atomically update user roles or TOTP enrollment state."""

        try:
            return await self._update_user_access_in_transaction(
                user_id,
                roles,
                reset_totp,
                actor_id,
            )
        except OperationFailure as exc:
            if not _transaction_unsupported(exc):
                raise
            return await self._update_user_access_without_transaction(
                user_id,
                roles,
                reset_totp,
                actor_id,
            )

    async def _update_user_access_in_transaction(
        self,
        user_id: str,
        roles: list[str] | None,
        reset_totp: bool,
        actor_id: str,
    ) -> UserRecord | None:
        async with await self.client.start_session() as session:
            async with session.start_transaction():
                data = await self.db.users.find_one(
                    {"id": user_id},
                    {"_id": False},
                    session=session,
                )
                if data is None:
                    return None
                user = UserRecord.model_validate(data)
                if await self._removes_last_admin(user, roles, actor_id, session):
                    raise LastAdminDemotionError
                return await self._apply_user_access_update(user, roles, reset_totp, session)

    async def _update_user_access_without_transaction(
        self,
        user_id: str,
        roles: list[str] | None,
        reset_totp: bool,
        actor_id: str,
    ) -> UserRecord | None:
        data = await self.db.users.find_one({"id": user_id}, {"_id": False})
        if data is None:
            return None
        user = UserRecord.model_validate(data)
        if await self._removes_last_admin(user, roles, actor_id, None):
            raise LastAdminDemotionError
        return await self._apply_user_access_update(user, roles, reset_totp, None)

    async def _removes_last_admin(
        self,
        user: UserRecord,
        roles: list[str] | None,
        actor_id: str,
        session: Any | None,
    ) -> bool:
        if roles is None or user.id != actor_id or not user.is_admin() or "admin" in roles:
            return False
        count = await self.db.users.count_documents(
            {"id": {"$ne": actor_id}, "roles": "admin", "disabled": {"$ne": True}},
            session=session,
        )
        return count == 0

    async def _apply_user_access_update(
        self,
        user: UserRecord,
        roles: list[str] | None,
        reset_totp: bool,
        session: Any | None,
    ) -> UserRecord:
        updates = _access_update_fields(roles, reset_totp)
        if not updates:
            return user
        await self.db.users.update_one({"id": user.id}, {"$set": updates}, session=session)
        return user.model_copy(update=updates)


def _access_update_fields(roles: list[str] | None, reset_totp: bool) -> dict[str, Any]:
    updates: dict[str, Any] = {}
    if roles is not None:
        updates["roles"] = roles
    if reset_totp:
        updates["totp_secret"] = None
        updates["totp_verified_at"] = None
    return updates


def _transaction_unsupported(exc: OperationFailure) -> bool:
    text = str(exc)
    return "Transaction numbers are only allowed" in text or "replica set member" in text
