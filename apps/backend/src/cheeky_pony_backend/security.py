# SPDX-License-Identifier: AGPL-3.0-only
"""Authentication, password, token, CSRF, and rate-limit helpers."""

from __future__ import annotations

import secrets
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from argon2.low_level import Type

from cheeky_pony_backend.config import Settings


class PasswordService:
    """Argon2id password hashing and verification."""

    def __init__(self) -> None:
        self._hasher = PasswordHasher(type=Type.ID)

    def hash_password(self, password: str) -> str:
        """Hash a password with Argon2id.

        Args:
            password: Plaintext password.

        Returns:
            Encoded password hash.
        """

        return self._hasher.hash(password)

    def verify(self, password_hash: str, password: str) -> bool:
        """Verify a plaintext password against a hash.

        Args:
            password_hash: Stored hash.
            password: Candidate password.

        Returns:
            True when the password matches.
        """

        try:
            return bool(self._hasher.verify(password_hash, password))
        except VerifyMismatchError:
            return False


class TokenService:
    """JWT access and refresh token service."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def create_access_token(self, subject: str, csrf: str | None = None) -> str:
        """Create a signed access token.

        Args:
            subject: User identifier.
            csrf: CSRF token bound to the session.

        Returns:
            Encoded JWT.
        """

        return self._create_token(
            subject,
            "access",
            timedelta(minutes=self._settings.access_token_minutes),
            csrf,
        )

    def create_refresh_token(self, subject: str) -> str:
        """Create a signed refresh token.

        Args:
            subject: User identifier.

        Returns:
            Encoded JWT.
        """

        return self._create_token(
            subject,
            "refresh",
            timedelta(days=self._settings.refresh_token_days),
            None,
        )

    def verify(self, token: str, expected_type: str) -> dict[str, Any]:
        """Verify and decode a JWT.

        Args:
            token: Encoded JWT.
            expected_type: Expected token type.

        Returns:
            Decoded claims.
        """

        claims = jwt.decode(
            token,
            self._settings.jwt_secret,
            algorithms=["HS256"],
            issuer=self._settings.jwt_issuer,
        )
        if claims.get("typ") != expected_type:
            msg = "wrong token type"
            raise jwt.InvalidTokenError(msg)
        return dict(claims)

    def _create_token(
        self,
        subject: str,
        token_type: str,
        lifetime: timedelta,
        csrf: str | None,
    ) -> str:
        now = datetime.now(tz=UTC)
        claims: dict[str, Any] = {
            "sub": subject,
            "typ": token_type,
            "iat": now,
            "exp": now + lifetime,
            "iss": self._settings.jwt_issuer,
        }
        if csrf:
            claims["csrf"] = csrf
        return jwt.encode(claims, self._settings.jwt_secret, algorithm="HS256")


class TotpService:
    """TOTP secret creation and verification."""

    def create_secret(self) -> str:
        """Create a TOTP shared secret.

        Returns:
            Base32 TOTP secret.
        """

        return pyotp.random_base32()

    def provisioning_uri(self, email: str, secret: str) -> str:
        """Create a provisioning URI.

        Args:
            email: Account email.
            secret: TOTP secret.

        Returns:
            otpauth provisioning URI.
        """

        return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name="Cheeky Pony")

    def verify(self, secret: str, code: str) -> bool:
        """Verify a TOTP code.

        Args:
            secret: TOTP secret.
            code: User-provided code.

        Returns:
            True when the code is valid within the allowed window.
        """

        return bool(pyotp.TOTP(secret).verify(code, valid_window=1))


class CsrfService:
    """CSRF token generation and verification."""

    def create_token(self) -> str:
        """Create a CSRF token.

        Returns:
            Random URL-safe token.
        """

        return secrets.token_urlsafe(32)

    def verify(self, expected: str | None, actual: str | None) -> bool:
        """Compare CSRF token values.

        Args:
            expected: Token expected from cookie or JWT claim.
            actual: Token submitted in the header.

        Returns:
            True when both tokens are present and equal.
        """

        return bool(expected and actual and secrets.compare_digest(expected, actual))


class RateLimiter:
    """Simple in-process sliding-window rate limiter for auth endpoints."""

    def __init__(self, limit: int = 10, window_seconds: int = 60) -> None:
        self._limit = limit
        self._window = timedelta(seconds=window_seconds)
        self._hits: dict[str, deque[datetime]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        """Return whether a request is allowed.

        Args:
            key: Rate-limit key.

        Returns:
            True when under the configured limit.
        """

        now = datetime.now(tz=UTC)
        hits = self._hits[key]
        while hits and now - hits[0] > self._window:
            hits.popleft()
        if len(hits) >= self._limit:
            return False
        hits.append(now)
        return True
