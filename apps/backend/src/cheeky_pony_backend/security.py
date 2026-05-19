# SPDX-License-Identifier: AGPL-3.0-only
"""Authentication, password, token, CSRF, and rate-limit helpers."""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from collections import defaultdict, deque
from collections.abc import Mapping
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

    def create_refresh_token(self, subject: str, refresh_token_version: int) -> str:
        """Create a signed refresh token.

        Args:
            subject: User identifier.
            refresh_token_version: User refresh-token version claim.

        Returns:
            Encoded JWT.
        """

        return self._create_token(
            subject,
            "refresh",
            timedelta(days=self._settings.refresh_token_days),
            None,
            refresh_token_version,
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
        refresh_token_version: int | None = None,
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
        if refresh_token_version is not None:
            claims["rv"] = refresh_token_version
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

    def reset(self, key: str) -> None:
        """Clear rate-limit state for one key."""

        self._hits.pop(key, None)

    def clear(self) -> None:
        """Clear all rate-limit state."""

        self._hits.clear()


_SUBJECT_CN_PATTERN = re.compile(r"(?:^|[,/])\s*CN\s*=\s*([^,/]+)")


def sign_sensor_gateway_headers(
    secret: str,
    sensor_id: str,
    subject: str,
    fingerprint_sha256: str,
    timestamp: int | None = None,
) -> dict[str, str]:
    """Create signed headers for a verified sensor-client certificate.

    Args:
        secret: Shared proxy/backend header-signing secret.
        sensor_id: Sensor identifier from the verified certificate identity.
        subject: Verified certificate subject.
        fingerprint_sha256: Verified certificate SHA-256 fingerprint.
        timestamp: Optional Unix timestamp.

    Returns:
        Headers consumed by the backend sensor gateway.
    """

    issued_at = timestamp or int(datetime.now(tz=UTC).timestamp())
    signature = _sensor_gateway_signature(secret, sensor_id, subject, fingerprint_sha256, issued_at)
    return {
        "x-client-cert-subject": subject,
        "x-client-cert-sha256": fingerprint_sha256.lower(),
        "x-client-cert-timestamp": str(issued_at),
        "x-client-cert-signature": signature,
    }


def verified_sensor_gateway_headers(
    headers: Mapping[str, str],
    secret: str | None,
    sensor_id: str,
    expected_fingerprint_sha256: str | None,
    skew_seconds: int,
    now: datetime | None = None,
) -> bool:
    """Validate proxy-signed mTLS identity headers for a sensor gateway.

    Args:
        headers: Incoming WebSocket headers.
        secret: Shared proxy/backend header-signing secret.
        sensor_id: Sensor id from the WebSocket query.
        expected_fingerprint_sha256: Stored certificate fingerprint.
        skew_seconds: Allowed signature timestamp skew.
        now: Optional current time for deterministic tests.

    Returns:
        True when the signed identity matches the registered sensor.
    """

    if secret is None or expected_fingerprint_sha256 is None:
        return False
    subject = headers.get("x-client-cert-subject")
    fingerprint = headers.get("x-client-cert-sha256")
    timestamp = _header_timestamp(headers.get("x-client-cert-timestamp"))
    actual_signature = headers.get("x-client-cert-signature")
    if not subject or not fingerprint or timestamp is None or not actual_signature:
        return False
    if _common_name(subject) != sensor_id:
        return False
    if not secrets.compare_digest(fingerprint.lower(), expected_fingerprint_sha256.lower()):
        return False
    current = now or datetime.now(tz=UTC)
    if abs(int(current.timestamp()) - timestamp) > skew_seconds:
        return False
    expected_signature = _sensor_gateway_signature(
        secret,
        sensor_id,
        subject,
        fingerprint.lower(),
        timestamp,
    )
    return secrets.compare_digest(expected_signature, actual_signature)


def _sensor_gateway_signature(
    secret: str,
    sensor_id: str,
    subject: str,
    fingerprint_sha256: str,
    timestamp: int,
) -> str:
    message = "\n".join([sensor_id, subject, fingerprint_sha256.lower(), str(timestamp)])
    return hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()


def _header_timestamp(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _common_name(subject: str) -> str | None:
    match = _SUBJECT_CN_PATTERN.search(subject)
    return match.group(1).strip() if match else None
