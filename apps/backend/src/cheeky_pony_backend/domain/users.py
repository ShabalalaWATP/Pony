# SPDX-License-Identifier: AGPL-3.0-only
"""User domain records and role helpers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from cheeky_pony_shared import UserPublic
from cheeky_pony_shared.models import utc_now

ALLOWED_USER_ROLES = frozenset({"admin", "operator"})


class LastAdminDemotionError(Exception):
    """Raised when an update would remove the final active admin."""


class UserRecord(BaseModel):
    """Internal persisted user record."""

    model_config = ConfigDict(extra="forbid")

    id: str
    email: EmailStr
    password_hash: str
    roles: list[str] = Field(default_factory=list)
    totp_secret: str | None = None
    totp_verified_at: datetime | None = None
    refresh_token_version: int = Field(default=0, ge=0)
    created_at: datetime = Field(default_factory=utc_now)
    disabled: bool = False

    def is_admin(self) -> bool:
        """Return whether the user has the admin role.

        Returns:
            True when admin role is present.
        """

        return "admin" in self.roles

    def has_recent_totp(self, recent_minutes: int = 15, now: datetime | None = None) -> bool:
        """Return whether the user completed TOTP in the recent window.

        Args:
            recent_minutes: Maximum accepted verification age in minutes.
            now: Optional current time for deterministic tests.

        Returns:
            True when TOTP verification is present and not expired.
        """

        if self.totp_verified_at is None:
            return False
        current = now or datetime.now(tz=UTC)
        verified_at = self.totp_verified_at
        if verified_at.tzinfo is None:
            verified_at = verified_at.replace(tzinfo=UTC)
        return current - verified_at <= timedelta(minutes=recent_minutes)

    def next_refresh_token_version(self) -> UserRecord:
        """Return a copy with every existing refresh token invalidated.

        Returns:
            Updated user record.
        """

        return self.model_copy(update={"refresh_token_version": self.refresh_token_version + 1})


def normalize_roles(roles: list[str]) -> list[str]:
    """Validate and de-duplicate user roles while preserving request order.

    Args:
        roles: Requested role list.

    Returns:
        Validated role list.

    Raises:
        ValueError: If a role is not in the allowed role set.
    """

    normalized: list[str] = []
    for role in roles:
        if role not in ALLOWED_USER_ROLES:
            msg = f"unsupported role: {role}"
            raise ValueError(msg)
        if role not in normalized:
            normalized.append(role)
    return normalized


def public_user(user: UserRecord) -> UserPublic:
    """Convert an internal user record into its public API shape.

    Args:
        user: Internal user record.

    Returns:
        Safe user fields for API responses.
    """

    return UserPublic(
        id=user.id,
        email=user.email,
        roles=user.roles,
        totp_enabled=user.totp_secret is not None,
    )
