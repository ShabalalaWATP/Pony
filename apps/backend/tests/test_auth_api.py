# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for backend authentication and browser security controls."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pyotp
import pytest
from conftest import BackendClient
from helpers import create_verified_admin

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.security import TokenService

pytestmark = pytest.mark.asyncio


async def test_health_is_public_and_has_security_headers(backend_client: BackendClient) -> None:
    """Health endpoint is public and receives response hardening headers."""

    response = await backend_client.client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["content-security-policy"].startswith("default-src")
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["pragma"] == "no-cache"


async def test_first_registration_creates_admin(backend_client: BackendClient) -> None:
    """The first registered user receives the admin role."""

    response = await backend_client.client.post(
        "/api/v1/auth/register",
        json={"email": "admin@example.com", "password": "long-password-123"},
    )

    assert response.status_code == 200
    assert response.json()["roles"] == ["admin"]


async def test_second_registration_requires_admin_2fa(backend_client: BackendClient) -> None:
    """Subsequent registration cannot be anonymous."""

    await backend_client.client.post(
        "/api/v1/auth/register",
        json={"email": "admin@example.com", "password": "long-password-123"},
    )
    response = await backend_client.client.post(
        "/api/v1/auth/register",
        json={"email": "operator@example.com", "password": "long-password-123"},
    )

    assert response.status_code == 403


async def test_csrf_required_for_authenticated_state_changes(backend_client: BackendClient) -> None:
    """Authenticated unsafe browser flows require the CSRF header."""

    await backend_client.client.post(
        "/api/v1/auth/register",
        json={"email": "admin@example.com", "password": "long-password-123"},
    )
    await backend_client.client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "long-password-123"},
    )

    response = await backend_client.client.post("/api/v1/auth/2fa/setup")

    assert response.status_code == 403


async def test_admin_totp_enables_sensor_registration(backend_client: BackendClient) -> None:
    """A TOTP-verified admin can register a sensor and receives PEM material."""

    csrf = await create_verified_admin(backend_client)

    response = await backend_client.client.post(
        "/api/v1/sensors",
        headers={"x-csrf-token": csrf},
        json={
            "id": "pi-1",
            "name": "Pi 1",
            "tailnet_ip": "100.64.0.10",
            "capabilities": ["passive_capture"],
            "version": "0.1.0",
        },
    )

    assert response.status_code == 200
    assert "BEGIN CERTIFICATE" in response.json()["client_certificate_pem"]
    assert response.json()["sensor"]["client_cert_fingerprint_sha256"]

    listed = await backend_client.client.get("/api/v1/sensors")
    fetched = await backend_client.client.get("/api/v1/sensors/pi-1")
    revoked = await backend_client.client.post(
        "/api/v1/sensors/pi-1/revoke",
        headers={"x-csrf-token": csrf},
    )

    assert listed.status_code == 200
    assert fetched.status_code == 200
    assert revoked.status_code == 204


async def test_duplicate_registration_and_invalid_login_are_rejected(
    backend_client: BackendClient,
) -> None:
    """Duplicate users and bad credentials are rejected."""

    await backend_client.client.post(
        "/api/v1/auth/register",
        json={"email": "admin@example.com", "password": "long-password-123"},
    )

    duplicate = await backend_client.client.post(
        "/api/v1/auth/register",
        json={"email": "admin@example.com", "password": "long-password-123"},
    )
    bad_login = await backend_client.client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "wrong"},
    )

    assert duplicate.status_code == 409
    assert bad_login.status_code == 401


async def test_refresh_rotates_session_tokens(backend_client: BackendClient) -> None:
    """Refresh creates a new access token and CSRF token."""

    await backend_client.client.post(
        "/api/v1/auth/register",
        json={"email": "admin@example.com", "password": "long-password-123"},
    )
    await backend_client.client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "long-password-123"},
    )

    response = await backend_client.client.post("/api/v1/auth/refresh")

    assert response.status_code == 200
    assert "csrf_token" in response.json()


async def test_logout_revokes_existing_refresh_token(backend_client: BackendClient) -> None:
    """Logout increments the refresh-token version so stolen refresh tokens fail."""

    csrf = await create_verified_admin(backend_client)
    old_refresh = backend_client.client.cookies.get("refresh_token")

    logout = await backend_client.client.post(
        "/api/v1/auth/logout",
        headers={"x-csrf-token": csrf},
    )
    backend_client.client.cookies.set("refresh_token", str(old_refresh))
    refreshed = await backend_client.client.post("/api/v1/auth/refresh")

    assert logout.status_code == 204
    assert refreshed.status_code == 401


async def test_existing_totp_secret_requires_recent_totp_to_rotate(
    backend_client: BackendClient,
) -> None:
    """The setup endpoint never re-discloses TOTP material without step-up auth."""

    csrf = await create_verified_admin(backend_client)
    user = next(iter(backend_client.store.users.values()))
    expired = datetime.now(tz=UTC) - timedelta(minutes=16)
    await backend_client.store.update_user(user.model_copy(update={"totp_verified_at": expired}))

    denied = await backend_client.client.post(
        "/api/v1/auth/2fa/setup",
        headers={"x-csrf-token": csrf},
    )
    user = next(iter(backend_client.store.users.values()))
    code = pyotp.TOTP(str(user.totp_secret)).now()
    await backend_client.client.post(
        "/api/v1/auth/2fa/verify",
        json={"code": code},
        headers={"x-csrf-token": csrf},
    )
    rotated = await backend_client.client.post(
        "/api/v1/auth/2fa/setup",
        headers={"x-csrf-token": csrf},
    )

    assert denied.status_code == 403
    assert rotated.status_code == 200
    assert rotated.json()["secret"] != user.totp_secret


async def test_stale_totp_does_not_satisfy_admin_gate(backend_client: BackendClient) -> None:
    """Admin-only routes require a bounded recent TOTP verification."""

    await backend_client.store.create_user(
        UserRecord(
            id="user-1",
            email="admin@example.com",
            password_hash="hash",
            roles=["admin"],
            totp_secret="JBSWY3DPEHPK3PXP",
            totp_verified_at=datetime.now(tz=UTC) - timedelta(minutes=16),
        )
    )
    settings = Settings(
        env="test",
        cookie_secure=False,
        jwt_secret="test-secret-test-secret-test-secret-123",
        use_in_memory_store=True,
    )
    access = TokenService(settings).create_access_token("user-1", "csrf")
    backend_client.client.cookies.set("access_token", access)

    response = await backend_client.client.get("/api/v1/sensors")

    assert response.status_code == 403


async def test_logout_clears_session_cookies_and_audits(
    backend_client: BackendClient,
) -> None:
    """Logout clears browser cookies and appends an audit entry."""

    csrf = await create_verified_admin(backend_client)

    response = await backend_client.client.post(
        "/api/v1/auth/logout",
        headers={"x-csrf-token": csrf},
    )

    set_cookies = response.headers.get_list("set-cookie")
    assert response.status_code == 204
    assert _clears_cookie(set_cookies, "access_token")
    assert _clears_cookie(set_cookies, "refresh_token")
    assert _clears_cookie(set_cookies, "csrf_token")
    assert backend_client.store.audit_logs[-1].action == "logout"

    denied = await backend_client.client.get("/api/v1/audit")
    assert denied.status_code == 401


def _clears_cookie(set_cookies: list[str], name: str) -> bool:
    return any(cookie.startswith(f"{name}=") and "Max-Age=0" in cookie for cookie in set_cookies)
