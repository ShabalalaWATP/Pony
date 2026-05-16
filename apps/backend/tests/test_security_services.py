# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for standalone backend security services."""

from __future__ import annotations

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.security import CsrfService, PasswordService, RateLimiter, TokenService


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
