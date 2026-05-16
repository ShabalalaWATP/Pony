# SPDX-License-Identifier: AGPL-3.0-only
"""Seed script for the initial backend admin user."""

from __future__ import annotations

import asyncio
from uuid import uuid4

from cheeky_pony_backend.config import get_settings
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.infra.mongo_store import MongoStore
from cheeky_pony_backend.security import PasswordService


async def seed_admin() -> None:
    """Create the initial admin user when no users exist."""

    settings = get_settings()
    store = MongoStore(settings.mongo_dsn, settings.mongo_db)
    await store.ensure_indexes()
    if await store.count_users() > 0:
        return
    user = UserRecord(
        id=str(uuid4()),
        email=settings.seed_admin_email,
        password_hash=PasswordService().hash_password(settings.seed_admin_password),
        roles=["admin"],
    )
    await store.create_user(user)


def main() -> None:
    """Run the seed script."""

    asyncio.run(seed_admin())


if __name__ == "__main__":
    main()
