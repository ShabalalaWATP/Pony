# SPDX-License-Identifier: AGPL-3.0-only
"""User domain records and role helpers."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from cheeky_pony_shared.models import utc_now


class UserRecord(BaseModel):
    """Internal persisted user record."""

    model_config = ConfigDict(extra="forbid")

    id: str
    email: EmailStr
    password_hash: str
    roles: list[str] = Field(default_factory=list)
    totp_secret: str | None = None
    totp_verified_at: datetime | None = None
    created_at: datetime = Field(default_factory=utc_now)
    disabled: bool = False

    def is_admin(self) -> bool:
        """Return whether the user has the admin role.

        Returns:
            True when admin role is present.
        """

        return "admin" in self.roles

    def has_recent_totp(self) -> bool:
        """Return whether the user has completed TOTP verification.

        Returns:
            True when a TOTP verification timestamp exists.
        """

        return self.totp_verified_at is not None
