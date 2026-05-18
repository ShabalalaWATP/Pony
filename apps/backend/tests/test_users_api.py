# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for admin user-management routes."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
import pytest
from conftest import BackendClient
from hypothesis import given
from hypothesis import strategies as st

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.users import UserRecord, public_user
from cheeky_pony_backend.infra.mongo_store import MongoStore
from cheeky_pony_backend.main import create_app
from cheeky_pony_backend.security import TokenService

TEST_SETTINGS = Settings(
    env="test",
    cookie_secure=False,
    jwt_secret="j" * 32,
    bootstrap_token="bootstrap-" + "token-test",
    use_in_memory_store=True,
)


@pytest.mark.asyncio
async def test_admin_can_list_users_without_secret_material(
    backend_client: BackendClient,
) -> None:
    """Verified admins receive stable paginated public user records only."""

    admin = await _create_user(backend_client, "admin", "admin@example.com", ["admin"])
    await _create_user(backend_client, "operator-a", "a@example.com", ["operator"], offset=1)
    await _create_user(backend_client, "operator-b", "b@example.com", ["operator"], offset=2)
    _authenticate(backend_client, admin.id)

    response = await backend_client.client.get("/api/v1/users", params={"limit": 2, "offset": 1})

    body = response.text
    assert response.status_code == 200
    assert response.json()["total"] == 3
    assert [item["email"] for item in response.json()["items"]] == [
        "a@example.com",
        "b@example.com",
    ]
    assert "password_hash" not in body
    assert "totp_secret" not in body
    assert "refresh_token" not in body


@pytest.mark.asyncio
async def test_user_list_requires_admin_and_recent_totp(
    backend_client: BackendClient,
) -> None:
    """User listing returns 403 for operators and stale admins."""

    operator = await _create_user(backend_client, "operator", "operator@example.com", ["operator"])
    stale_admin = await _create_user(
        backend_client,
        "stale-admin",
        "stale@example.com",
        ["admin"],
        verified_at=datetime.now(tz=UTC) - timedelta(minutes=16),
    )

    _authenticate(backend_client, operator.id)
    operator_response = await backend_client.client.get("/api/v1/users")
    _authenticate(backend_client, stale_admin.id)
    stale_response = await backend_client.client.get("/api/v1/users")

    assert operator_response.status_code == 403
    assert stale_response.status_code == 403


@pytest.mark.asyncio
async def test_admin_can_update_user_roles_and_reset_totp(
    backend_client: BackendClient,
) -> None:
    """Verified admins can promote users and reset TOTP enrollment."""

    admin = await _create_user(backend_client, "admin", "admin@example.com", ["admin"])
    target = await _create_user(
        backend_client,
        "operator",
        "operator@example.com",
        ["operator"],
        totp_secret="JBSWY3DPEHPK3PXP",
    )
    csrf = _authenticate(backend_client, admin.id)

    promoted = await backend_client.client.patch(
        f"/api/v1/users/{target.id}",
        headers={"x-csrf-token": csrf},
        json={"roles": ["operator", "admin"]},
    )
    reset = await backend_client.client.patch(
        f"/api/v1/users/{target.id}",
        headers={"x-csrf-token": csrf},
        json={"reset_totp": True},
    )
    stored = await backend_client.store.get_user(target.id)

    assert promoted.status_code == 200
    assert promoted.json()["roles"] == ["operator", "admin"]
    assert reset.status_code == 200
    assert reset.json()["totp_enabled"] is False
    assert stored is not None
    assert stored.totp_secret is None
    assert [log.outcome for log in backend_client.store.audit_logs[-2:]] == ["ok", "ok"]
    assert "totp_secret" not in backend_client.store.audit_logs[-1].model_dump_json()


@pytest.mark.asyncio
async def test_user_update_rejects_missing_invalid_and_last_admin(
    backend_client: BackendClient,
) -> None:
    """User updates audit business denials."""

    admin = await _create_user(backend_client, "admin", "admin@example.com", ["admin"])
    csrf = _authenticate(backend_client, admin.id)

    missing = await backend_client.client.patch(
        "/api/v1/users/missing",
        headers={"x-csrf-token": csrf},
        json={"roles": ["operator"]},
    )
    invalid = await backend_client.client.patch(
        f"/api/v1/users/{admin.id}",
        headers={"x-csrf-token": csrf},
        json={"roles": ["root"]},
    )
    last_admin = await backend_client.client.patch(
        f"/api/v1/users/{admin.id}",
        headers={"x-csrf-token": csrf},
        json={"roles": ["operator"]},
    )
    stored = await backend_client.store.get_user(admin.id)

    assert missing.status_code == 404
    assert invalid.status_code == 422
    assert last_admin.status_code == 409
    assert stored is not None
    assert stored.roles == ["admin"]
    assert [log.outcome for log in backend_client.store.audit_logs[-3:]] == [
        "denied:not_found",
        "denied:invalid_role",
        "denied:last_admin",
    ]


@pytest.mark.asyncio
async def test_user_update_requires_admin_and_recent_totp(
    backend_client: BackendClient,
) -> None:
    """Role mutation returns 403 for non-admins and stale admins."""

    operator = await _create_user(backend_client, "operator", "operator@example.com", ["operator"])
    stale_admin = await _create_user(
        backend_client,
        "stale-admin",
        "stale@example.com",
        ["admin"],
        verified_at=datetime.now(tz=UTC) - timedelta(minutes=16),
    )
    target = await _create_user(backend_client, "target", "target@example.com", ["operator"])

    csrf = _authenticate(backend_client, operator.id)
    operator_response = await backend_client.client.patch(
        f"/api/v1/users/{target.id}",
        headers={"x-csrf-token": csrf},
        json={"roles": ["admin"]},
    )
    csrf = _authenticate(backend_client, stale_admin.id)
    stale_response = await backend_client.client.patch(
        f"/api/v1/users/{target.id}",
        headers={"x-csrf-token": csrf},
        json={"roles": ["admin"]},
    )

    assert operator_response.status_code == 403
    assert stale_response.status_code == 403


@given(
    suffix=st.text(alphabet="abcdefghijklmnopqrstuvwxyz0123456789", min_size=1, max_size=16),
    password_tail=st.text(
        alphabet="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        min_size=12,
        max_size=32,
    ),
    has_totp=st.booleans(),
)
def test_public_user_shape_never_serializes_secret_material(
    suffix: str,
    password_tail: str,
    has_totp: bool,
) -> None:
    """Public user projection omits secret-bearing fields for arbitrary users."""

    user = UserRecord(
        id=f"user-{suffix}",
        email=f"{suffix}@example.com",
        password_hash=f"hash-{password_tail}",
        roles=["operator"],
        totp_secret="JBSWY3DPEHPK3PXP" if has_totp else None,
    )

    body = public_user(user).model_dump_json()

    assert "password_hash" not in body
    assert "totp_secret" not in body
    assert user.password_hash not in body
    if user.totp_secret is not None:
        assert user.totp_secret not in body


@pytest.mark.slow
@pytest.mark.asyncio
async def test_user_update_audit_round_trips_through_mongo() -> None:
    """User-update audit entries persist and read back through real MongoDB."""

    async with _mongo_backend_client() as bundle:
        admin = await _create_user(bundle, "admin", "admin@example.com", ["admin"])
        target = await _create_user(bundle, "operator", "operator@example.com", ["operator"])
        csrf = _authenticate(bundle, admin.id)

        updated = await bundle.client.patch(
            f"/api/v1/users/{target.id}",
            headers={"x-csrf-token": csrf},
            json={"roles": ["operator", "admin"]},
        )
        audit = await bundle.client.get("/api/v1/audit")

        assert updated.status_code == 200
        assert audit.status_code == 200
        assert audit.json()["items"][0]["action"] == "user.update"
        assert audit.json()["items"][0]["outcome"] == "ok"
        assert audit.json()["items"][0]["target"] == {"user_id": target.id}


async def _create_user(
    bundle: BackendClient,
    user_id: str,
    email: str,
    roles: list[str],
    offset: int = 0,
    verified_at: datetime | None = None,
    totp_secret: str | None = None,
) -> UserRecord:
    user = UserRecord(
        id=user_id,
        email=email,
        password_hash=f"hash-{user_id}",
        roles=roles,
        totp_secret=totp_secret or "JBSWY3DPEHPK3PXP",
        totp_verified_at=verified_at or datetime.now(tz=UTC),
        created_at=datetime(2026, 1, 1 + offset, tzinfo=UTC),
    )
    return await bundle.store.create_user(user)


def _authenticate(bundle: BackendClient, user_id: str, csrf: str = "csrf") -> str:
    token = TokenService(TEST_SETTINGS).create_access_token(user_id, csrf)
    bundle.client.cookies.set("access_token", token)
    return csrf


@asynccontextmanager
async def _mongo_backend_client() -> AsyncIterator[BackendClient]:
    from testcontainers.mongodb import MongoDbContainer

    with MongoDbContainer("mongo:7.0.7") as container:
        database = f"cheeky_pony_test_{uuid4().hex}"
        store = MongoStore(container.get_connection_url(), database)
        await store.ensure_indexes()
        app = create_app(settings=TEST_SETTINGS, store=store)
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield BackendClient(client, store)  # type: ignore[arg-type]
        await store.client.drop_database(database)
        store.client.close()
