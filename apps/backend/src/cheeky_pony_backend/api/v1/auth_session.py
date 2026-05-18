# SPDX-License-Identifier: AGPL-3.0-only
"""Session helpers for authentication routes."""

from __future__ import annotations

import jwt
from fastapi import Request, Response

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.security import TokenService


async def optional_user(
    request: Request,
    store: Store,
    tokens: TokenService,
) -> UserRecord | None:
    """Resolve an optional access-token user from Bearer auth or cookies."""

    token = bearer_token(request) or request.cookies.get("access_token")
    if not token:
        return None
    try:
        claims = tokens.verify(token, "access")
    except jwt.InvalidTokenError:
        return None
    return await store.get_user(str(claims["sub"]))


def bearer_token(request: Request) -> str | None:
    """Return a Bearer token from the Authorization header when present."""

    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:]
    return None


def set_cookie(
    response: Response,
    name: str,
    value: str,
    settings: Settings,
    httponly: bool = True,
) -> None:
    """Set a session cookie using the backend cookie policy."""

    response.set_cookie(
        name,
        value,
        httponly=httponly,
        secure=settings.cookie_secure,
        samesite="strict",
    )


def clear_cookie(
    response: Response,
    name: str,
    settings: Settings,
    httponly: bool,
) -> None:
    """Clear a session cookie using the backend cookie policy."""

    response.delete_cookie(
        name,
        httponly=httponly,
        secure=settings.cookie_secure,
        samesite="strict",
    )


def refresh_claim_matches_user(claims: dict[str, object], user: UserRecord) -> bool:
    """Return whether refresh-token version claims still match the user."""

    raw_version = claims.get("rv")
    if not isinstance(raw_version, int | str) or isinstance(raw_version, bool):
        return False
    try:
        token_version = int(raw_version)
    except ValueError:
        return False
    return token_version == user.refresh_token_version
