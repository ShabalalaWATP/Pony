# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for standalone backend security services."""

from __future__ import annotations

import pytest

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.security import (
    CsrfService,
    PasswordService,
    RateLimiter,
    TokenService,
    sign_sensor_gateway_headers,
    verified_sensor_gateway_headers,
)


def test_password_and_token_services_round_trip() -> None:
    """Password hashes and JWTs verify successfully."""

    passwords = PasswordService()
    password_hash = passwords.hash_password("long-password-123")
    tokens = TokenService(
        Settings(env="test", jwt_secret="test-secret-test-secret-test-secret-123")
    )
    access = tokens.create_access_token("user-1", "csrf")

    assert passwords.verify(password_hash, "long-password-123")
    assert not passwords.verify(password_hash, "wrong-password")
    assert tokens.verify(access, "access")["sub"] == "user-1"


def test_csrf_and_rate_limiter_reject_bad_values() -> None:
    """CSRF compare and rate limiter cover reject branches."""

    csrf = CsrfService()
    limiter = RateLimiter(limit=1, window_seconds=60)

    assert csrf.verify("token", "token")
    assert not csrf.verify("token", "other")
    assert limiter.allow("client")
    assert not limiter.allow("client")


def test_production_settings_reject_development_secrets() -> None:
    """Production-like environments must not boot with known defaults."""

    with pytest.raises(ValueError, match="JWT_SECRET"):
        Settings(env="prod", _env_file=None)


def test_sensor_gateway_signed_headers_are_bound_to_sensor_identity() -> None:
    """Sensor mTLS proxy headers require signature, CN, and fingerprint binding."""

    header_value = "".join(["test-", "sensor-", "header-", "value-", "1234567890"])
    fingerprint = "c" * 64
    headers = sign_sensor_gateway_headers(header_value, "pi-1", "CN=pi-1", fingerprint)

    assert verified_sensor_gateway_headers(headers, header_value, "pi-1", fingerprint, 300)
    assert not verified_sensor_gateway_headers(headers, header_value, "pi-2", fingerprint, 300)
    assert not verified_sensor_gateway_headers(headers, header_value, "pi-1", "d" * 64, 300)
    assert not verified_sensor_gateway_headers(
        {"x-client-cert-subject": "CN=pi-1"},
        header_value,
        "pi-1",
        fingerprint,
        300,
    )
