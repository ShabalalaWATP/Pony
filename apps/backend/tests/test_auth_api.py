# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for backend authentication and browser security controls."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx
import pyotp
import pytest
from conftest import BackendClient
from helpers import BOOTSTRAP_HEADERS, BOOTSTRAP_TOKEN, create_verified_admin
from pydantic import ValidationError

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.dependencies import reset_auth_rate_limiters
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.infra.in_memory_store import InMemoryStore
from cheeky_pony_backend.main import create_app
from cheeky_pony_backend.security import PasswordService, TokenService

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
        headers=BOOTSTRAP_HEADERS,
        json={"email": "admin@example.com", "password": "long-password-123"},
    )

    assert response.status_code == 200
    assert response.json()["roles"] == ["admin"]
    assert backend_client.store.audit_logs[-1].action == "auth.register"
    assert backend_client.store.audit_logs[-1].outcome == "ok"


async def test_first_admin_bootstrap_token_is_required() -> None:
    """First-admin bootstrap is disabled unless an operator sets the token."""

    disabled = await _register_first_admin(
        Settings(env="test", cookie_secure=False, jwt_secret="j" * 32)
    )
    wrong = await _register_first_admin(
        Settings(
            env="test",
            cookie_secure=False,
            jwt_secret="j" * 32,
            bootstrap_token=BOOTSTRAP_TOKEN,
        ),
        headers={"authorization": "Bearer wrong-token"},
    )
    correct = await _register_first_admin(
        Settings(
            env="test",
            cookie_secure=False,
            jwt_secret="j" * 32,
            bootstrap_token=BOOTSTRAP_TOKEN,
        ),
        headers=BOOTSTRAP_HEADERS,
    )

    assert disabled[0] == 503
    assert disabled[1] == "denied:bootstrap_disabled"
    assert wrong[0] == 401
    assert wrong[1] == "denied:invalid_bootstrap_token"
    assert correct[0] == 200
    assert correct[1] == "ok"


async def test_cors_wildcard_is_rejected() -> None:
    """Credentialed CORS configuration refuses wildcard origins."""

    with pytest.raises(ValidationError):
        Settings(env="test", cookie_secure=False, jwt_secret="j" * 32, cors_origins=["*"])


async def test_second_registration_requires_admin_2fa(backend_client: BackendClient) -> None:
    """Subsequent registration cannot be anonymous."""

    await backend_client.client.post(
        "/api/v1/auth/register",
        headers=BOOTSTRAP_HEADERS,
        json={"email": "admin@example.com", "password": "long-password-123"},
    )
    response = await backend_client.client.post(
        "/api/v1/auth/register",
        json={"email": "operator@example.com", "password": "long-password-123"},
    )

    assert response.status_code == 403
    assert backend_client.store.audit_logs[-1].outcome == "denied:not_first_admin"


async def test_csrf_required_for_authenticated_state_changes(backend_client: BackendClient) -> None:
    """Authenticated unsafe browser flows require the CSRF header."""

    await backend_client.client.post(
        "/api/v1/auth/register",
        headers=BOOTSTRAP_HEADERS,
        json={"email": "admin@example.com", "password": "long-password-123"},
    )
    await backend_client.client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "long-password-123"},
    )

    response = await backend_client.client.post("/api/v1/auth/2fa/setup")

    assert response.status_code == 403


async def test_csrf_required_for_bearer_authenticated_state_changes(
    backend_client: BackendClient,
) -> None:
    """Bearer-authenticated unsafe requests still require the CSRF header."""

    await backend_client.store.create_user(
        UserRecord(
            id="admin",
            email="admin@example.com",
            password_hash="hash",
            roles=["admin"],
            totp_secret="JBSWY3DPEHPK3PXP",
            totp_verified_at=datetime.now(tz=UTC),
        )
    )
    token = TokenService(
        Settings(
            env="test",
            cookie_secure=False,
            jwt_secret="j" * 32,
            bootstrap_token=BOOTSTRAP_TOKEN,
            use_in_memory_store=True,
        )
    ).create_access_token("admin", "csrf")

    response = await backend_client.client.patch(
        "/api/v1/users/admin",
        headers={"authorization": f"Bearer {token}"},
        json={"roles": ["admin"]},
    )

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
        headers=BOOTSTRAP_HEADERS,
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
    assert [log.outcome for log in backend_client.store.audit_logs[-2:]] == [
        "denied:duplicate_email",
        "denied:invalid_credentials",
    ]


async def test_login_success_is_audited_without_password(
    backend_client: BackendClient,
) -> None:
    """Successful login records the account but never the submitted password."""

    await backend_client.client.post(
        "/api/v1/auth/register",
        headers=BOOTSTRAP_HEADERS,
        json={"email": "admin@example.com", "password": "long-password-123"},
    )

    response = await backend_client.client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "long-password-123"},
    )
    audit = backend_client.store.audit_logs[-1]

    assert response.status_code == 200
    assert audit.action == "auth.login"
    assert audit.outcome == "ok"
    assert audit.target["email"] == "admin@example.com"
    assert "long-password-123" not in audit.model_dump_json()


async def test_disabled_user_cannot_login_refresh_or_register_users(
    backend_client: BackendClient,
) -> None:
    """Disabled accounts cannot mint sessions or use auth-only admin paths."""

    settings = Settings(
        env="test",
        cookie_secure=False,
        jwt_secret="j" * 32,
        bootstrap_token=BOOTSTRAP_TOKEN,
        use_in_memory_store=True,
    )
    await backend_client.store.create_user(
        UserRecord(
            id="disabled-admin",
            email="disabled@example.com",
            password_hash=PasswordService().hash_password("long-password-123"),
            roles=["admin"],
            totp_secret="JBSWY3DPEHPK3PXP",
            totp_verified_at=datetime.now(tz=UTC),
            disabled=True,
        )
    )

    login = await backend_client.client.post(
        "/api/v1/auth/login",
        json={"email": "disabled@example.com", "password": "long-password-123"},
    )
    backend_client.client.cookies.set(
        "refresh_token",
        TokenService(settings).create_refresh_token("disabled-admin", 0),
    )
    refresh = await backend_client.client.post("/api/v1/auth/refresh")
    backend_client.client.cookies.set(
        "access_token",
        TokenService(settings).create_access_token("disabled-admin", "csrf"),
    )
    register = await backend_client.client.post(
        "/api/v1/auth/register",
        json={"email": "child@example.com", "password": "long-password-123"},
    )

    assert login.status_code == 401
    assert login.json()["detail"] == "invalid_user"
    assert refresh.status_code == 401
    assert refresh.json()["detail"] == "invalid_user"
    assert register.status_code == 403
    assert await backend_client.store.get_user_by_email("child@example.com") is None


async def test_register_extra_fields_are_forbidden(backend_client: BackendClient) -> None:
    """Register rejects extra fields instead of accepting mass-assignment input."""

    response = await backend_client.client.post(
        "/api/v1/auth/register",
        headers=BOOTSTRAP_HEADERS,
        json={
            "email": "admin@example.com",
            "password": "long-password-123",
            "roles": ["admin"],
        },
    )

    assert response.status_code == 422
    assert backend_client.store.audit_logs[-1].action == "auth.register"
    assert backend_client.store.audit_logs[-1].outcome == "denied:invalid_payload"
    assert backend_client.store.audit_logs[-1].parameters["body"]["password"] == "[redacted]"


async def test_refresh_rotates_session_tokens(backend_client: BackendClient) -> None:
    """Refresh creates a new access token and CSRF token."""

    await backend_client.client.post(
        "/api/v1/auth/register",
        headers=BOOTSTRAP_HEADERS,
        json={"email": "admin@example.com", "password": "long-password-123"},
    )
    await backend_client.client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "long-password-123"},
    )

    response = await backend_client.client.post("/api/v1/auth/refresh")

    assert response.status_code == 200
    assert "csrf_token" in response.json()
    assert backend_client.store.audit_logs[-1].action == "auth.refresh"
    assert backend_client.store.audit_logs[-1].outcome == "ok"


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
    assert backend_client.store.audit_logs[-1].action == "auth.refresh"
    assert backend_client.store.audit_logs[-1].outcome == "denied:invalid_user"


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
    assert [log.outcome for log in backend_client.store.audit_logs[-3:]] == [
        "denied:totp_required",
        "ok",
        "ok",
    ]
    assert backend_client.store.audit_logs[-1].parameters == {"reset": True}
    assert "secret" not in backend_client.store.audit_logs[-1].model_dump_json()


async def test_totp_verify_denial_is_audited(backend_client: BackendClient) -> None:
    """Invalid TOTP attempts audit the denial without logging the submitted code."""

    csrf = await create_verified_admin(backend_client)
    user = next(iter(backend_client.store.users.values()))
    bad_code = _invalid_totp_code(str(user.totp_secret))

    response = await backend_client.client.post(
        "/api/v1/auth/2fa/verify",
        json={"code": bad_code},
        headers={"x-csrf-token": csrf},
    )
    audit = backend_client.store.audit_logs[-1]

    assert response.status_code == 401
    assert audit.action == "auth.2fa.verify"
    assert audit.outcome == "denied:invalid_totp"
    assert bad_code not in audit.model_dump_json()


async def test_auth_rate_limits_cover_login_and_totp_verify(
    backend_client: BackendClient,
) -> None:
    """Credential and TOTP attempts are throttled by the auth limiter."""

    csrf = await create_verified_admin(backend_client)
    reset_auth_rate_limiters()

    for _ in range(10):
        login = await backend_client.client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "wrong"},
        )
        assert login.status_code == 401
    throttled_login = await backend_client.client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "wrong"},
    )

    reset_auth_rate_limiters()
    user = next(iter(backend_client.store.users.values()))
    bad_code = _invalid_totp_code(str(user.totp_secret))
    for _ in range(10):
        totp = await backend_client.client.post(
            "/api/v1/auth/2fa/verify",
            json={"code": bad_code},
            headers={"x-csrf-token": csrf},
        )
        assert totp.status_code == 401
    throttled_totp = await backend_client.client.post(
        "/api/v1/auth/2fa/verify",
        json={"code": bad_code},
        headers={"x-csrf-token": csrf},
    )

    assert throttled_login.status_code == 429
    assert throttled_totp.status_code == 429


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
        jwt_secret="j" * 32,
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


def _invalid_totp_code(secret: str) -> str:
    current = pyotp.TOTP(secret).now()
    return "000000" if current != "000000" else "111111"


async def _register_first_admin(
    settings: Settings,
    headers: dict[str, str] | None = None,
) -> tuple[int, str]:
    reset_auth_rate_limiters()
    store = InMemoryStore()
    app = create_app(settings=settings, store=store)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/register",
            headers=headers,
            json={"email": "admin@example.com", "password": "long-password-123"},
        )
    return response.status_code, store.audit_logs[-1].outcome
