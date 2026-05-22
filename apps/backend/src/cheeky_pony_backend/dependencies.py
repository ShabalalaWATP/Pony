# SPDX-License-Identifier: AGPL-3.0-only
"""FastAPI dependency providers for settings, stores, auth, and services."""

from __future__ import annotations

from typing import Annotated, cast

import jwt
from fastapi import Depends, HTTPException, Request, status

from cheeky_pony_backend.config import Settings, get_settings
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.oui_lookup import OuiService, create_oui_service
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.infra.operator_broker import OperatorBroker
from cheeky_pony_backend.infra.sensor_command_broker import SensorCommandBroker
from cheeky_pony_backend.security import (
    CsrfService,
    PasswordService,
    RateLimiter,
    TokenService,
    TotpService,
)

PASSWORD_SERVICE = PasswordService()
TOTP_SERVICE = TotpService()
CSRF_SERVICE = CsrfService()
OUI_SERVICE = create_oui_service()
AUTH_RATE_LIMITER = RateLimiter(limit=10)
ACCOUNT_AUTH_RATE_LIMITER = RateLimiter(limit=10)


def get_store(request: Request) -> Store:
    """Return the application store from FastAPI state.

    Args:
        request: FastAPI request.

    Returns:
        Configured store.
    """

    return cast(Store, request.app.state.store)


def get_sensor_command_broker(request: Request) -> SensorCommandBroker:
    """Return the sensor command broker from FastAPI state.

    Args:
        request: FastAPI request.

    Returns:
        Sensor command broker.
    """

    return cast(SensorCommandBroker, request.app.state.sensor_command_broker)


def get_operator_broker(request: Request) -> OperatorBroker:
    """Return the operator broker from FastAPI state.

    Args:
        request: FastAPI request.

    Returns:
        Operator broker.
    """

    return cast(OperatorBroker, request.app.state.operator_broker)


def get_password_service() -> PasswordService:
    """Return password service.

    Returns:
        Password service singleton.
    """

    return PASSWORD_SERVICE


def get_totp_service() -> TotpService:
    """Return TOTP service.

    Returns:
        TOTP service singleton.
    """

    return TOTP_SERVICE


def get_csrf_service() -> CsrfService:
    """Return CSRF service.

    Returns:
        CSRF service singleton.
    """

    return CSRF_SERVICE


def get_oui_service() -> OuiService:
    """Return the OUI vendor lookup service.

    Returns:
        OUI lookup service singleton.
    """

    return OUI_SERVICE


def get_token_service(settings: Annotated[Settings, Depends(get_settings)]) -> TokenService:
    """Return token service bound to current settings.

    Args:
        settings: Runtime settings.

    Returns:
        Token service.
    """

    return TokenService(settings)


def get_audit_logger(store: Annotated[Store, Depends(get_store)]) -> AuditLogger:
    """Return audit logger.

    Args:
        store: Application store.

    Returns:
        Audit logger.
    """

    return AuditLogger(store)


async def current_user(
    request: Request,
    store: Annotated[Store, Depends(get_store)],
    tokens: Annotated[TokenService, Depends(get_token_service)],
) -> UserRecord:
    """Resolve the current authenticated user.

    Args:
        request: FastAPI request.
        store: Application store.
        tokens: Token service.

    Returns:
        Authenticated user.

    Raises:
        HTTPException: If authentication fails.
    """

    token = _bearer_token(request) or request.cookies.get("access_token")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="authentication_required",
        )
    try:
        claims = tokens.verify(token, "access")
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_token",
        ) from exc
    user = await store.get_user(str(claims["sub"]))
    if user is None or user.disabled:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_user")
    return user


async def require_admin(user: Annotated[UserRecord, Depends(current_user)]) -> UserRecord:
    """Require an authenticated admin.

    Args:
        user: Current user.

    Returns:
        Current admin user.
    """

    if not user.is_admin():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin_required")
    return user


async def require_admin_2fa(
    user: Annotated[UserRecord, Depends(require_admin)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> UserRecord:
    """Require admin role and verified TOTP.

    Args:
        user: Current admin user.
        settings: Runtime settings.

    Returns:
        Current admin user with TOTP verification.
    """

    if not user.has_recent_totp(settings.totp_recent_minutes):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="totp_required")
    return user


def check_auth_rate_limit(request: Request) -> None:
    """Apply the auth endpoint rate limit.

    Args:
        request: FastAPI request.

    Raises:
        HTTPException: When the limit is exceeded.
    """

    host = request.client.host if request.client else "unknown"
    if not AUTH_RATE_LIMITER.allow(host):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="rate_limited")


def check_account_auth_rate_limit(email: str) -> None:
    """Apply the account-level auth endpoint rate limit.

    Args:
        email: Target account email address.

    Raises:
        HTTPException: When the limit is exceeded.
    """

    if not ACCOUNT_AUTH_RATE_LIMITER.allow(email.lower()):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="rate_limited")


def reset_account_auth_rate_limit(email: str) -> None:
    """Clear account-level auth throttling after successful login."""

    ACCOUNT_AUTH_RATE_LIMITER.reset(email.lower())


def reset_auth_rate_limiters() -> None:
    """Clear in-process auth throttles for isolated tests."""

    AUTH_RATE_LIMITER.clear()
    ACCOUNT_AUTH_RATE_LIMITER.clear()


def _bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:]
    return None
