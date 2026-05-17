# SPDX-License-Identifier: AGPL-3.0-only
"""In-memory user persistence operations."""

from __future__ import annotations

import asyncio
from collections.abc import Iterable
from typing import Any

from cheeky_pony_backend.domain.users import LastAdminDemotionError, UserRecord


class InMemoryUserStoreMixin:
    """User persistence operations for the in-memory store."""

    _lock: asyncio.Lock
    users: dict[str, UserRecord]

    async def count_users(self) -> int:
        """Return the number of users."""

        return len(self.users)

    async def create_user(self, user: UserRecord) -> UserRecord:
        """Persist a user."""

        async with self._lock:
            self.users[user.id] = user
        return user

    async def get_user_by_email(self, email: str) -> UserRecord | None:
        """Look up a user by email."""

        return next((user for user in self.users.values() if user.email == email), None)

    async def get_user(self, user_id: str) -> UserRecord | None:
        """Look up a user by id."""

        return self.users.get(user_id)

    async def list_users(self, limit: int, offset: int) -> tuple[list[UserRecord], int]:
        """List users in stable order."""

        values = sorted(self.users.values(), key=lambda user: (user.created_at, user.email))
        return values[offset : offset + limit], len(values)

    async def update_user(self, user: UserRecord) -> UserRecord:
        """Persist updated user fields."""

        async with self._lock:
            self.users[user.id] = user
        return user

    async def update_user_access(
        self,
        user_id: str,
        roles: list[str] | None,
        reset_totp: bool,
        actor_id: str,
    ) -> UserRecord | None:
        """Atomically update user roles or TOTP enrollment state."""

        async with self._lock:
            user = self.users.get(user_id)
            if user is None:
                return None
            if _would_remove_last_admin(user, roles, actor_id, self.users.values()):
                raise LastAdminDemotionError
            updates: dict[str, Any] = {}
            if roles is not None:
                updates["roles"] = roles
            if reset_totp:
                updates["totp_secret"] = None
                updates["totp_verified_at"] = None
            updated = user.model_copy(update=updates)
            self.users[user.id] = updated
            return updated


def _would_remove_last_admin(
    target: UserRecord,
    roles: list[str] | None,
    actor_id: str,
    users: Iterable[UserRecord],
) -> bool:
    if roles is None or target.id != actor_id or not target.is_admin() or "admin" in roles:
        return False
    return not any(user.id != actor_id and user.is_admin() and not user.disabled for user in users)
