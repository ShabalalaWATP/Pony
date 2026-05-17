# SPDX-License-Identifier: AGPL-3.0-only
"""Authentication and TOTP API routes."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import uuid4

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field

from cheeky_pony_backend.config import Settings, get_settings
from cheeky_pony_backend.dependencies import (
    check_auth_rate_limit,
    current_user,
    get_audit_logger,
    get_csrf_service,
    get_password_service,
    get_store,
    get_token_service,
    get_totp_service,
)
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.users import UserRecord, public_user
from cheeky_pony_backend.security import CsrfService, PasswordService, TokenService, TotpService
from cheeky_pony_shared import UserPublic

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    """User registration request."""

    email: EmailStr
    password: str = Field(min_length=12, max_length=256)


class LoginRequest(BaseModel):
    """User login request."""

    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class TotpSetupResponse(BaseModel):
    """TOTP setup response."""

    secret: str
    provisioning_uri: str


class TotpVerifyRequest(BaseModel):
    """TOTP verification request."""

    code: str = Field(min_length=6, max_length=8)


class LoginResponse(BaseModel):
    """Login response payload."""

    user: UserPublic
    csrf_token: str


@router.post("/register", response_model=UserPublic, dependencies=[Depends(check_auth_rate_limit)])
async def register(
    payload: RegisterRequest,
    request: Request,
    store: Annotated[Store, Depends(get_store)],
    passwords: Annotated[PasswordService, Depends(get_password_service)],
    tokens: Annotated[TokenService, Depends(get_token_service)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> UserPublic:
    """Register the first admin or an admin-created user.

    Args:
        payload: Registration payload.
        request: FastAPI request.
        store: Application store.
        passwords: Password service.
        tokens: Token service.
        settings: Runtime settings.

    Returns:
        Created public user.
    """

    if await store.get_user_by_email(str(payload.email)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="email_exists")
    roles = ["admin"] if await store.count_users() == 0 else ["operator"]
    if roles != ["admin"]:
        user = await _optional_user(request, store, tokens)
        if (
            user is None
            or not user.is_admin()
            or not user.has_recent_totp(settings.totp_recent_minutes)
        ):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin_2fa_required")
    user = UserRecord(
        id=str(uuid4()),
        email=payload.email,
        password_hash=passwords.hash_password(payload.password),
        roles=roles,
    )
    await store.create_user(user)
    return public_user(user)


@router.post("/login", response_model=LoginResponse, dependencies=[Depends(check_auth_rate_limit)])
async def login(
    payload: LoginRequest,
    response: Response,
    store: Annotated[Store, Depends(get_store)],
    passwords: Annotated[PasswordService, Depends(get_password_service)],
    csrf: Annotated[CsrfService, Depends(get_csrf_service)],
    tokens: Annotated[TokenService, Depends(get_token_service)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> LoginResponse:
    """Authenticate a user and set secure cookies.

    Args:
        payload: Login payload.
        response: FastAPI response.
        store: Application store.
        passwords: Password service.
        csrf: CSRF service.
        tokens: Token service.
        settings: Runtime settings.

    Returns:
        Public user and CSRF token.
    """

    user = await store.get_user_by_email(str(payload.email))
    if user is None or not passwords.verify(user.password_hash, payload.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_credentials")
    csrf_token = csrf.create_token()
    _set_cookie(response, "access_token", tokens.create_access_token(user.id, csrf_token), settings)
    _set_cookie(
        response,
        "refresh_token",
        tokens.create_refresh_token(user.id, user.refresh_token_version),
        settings,
    )
    response.set_cookie(
        "csrf_token",
        csrf_token,
        httponly=False,
        secure=settings.cookie_secure,
        samesite="strict",
    )
    return LoginResponse(user=public_user(user), csrf_token=csrf_token)


@router.post(
    "/refresh",
    response_model=LoginResponse,
    dependencies=[Depends(check_auth_rate_limit)],
)
async def refresh(
    request: Request,
    response: Response,
    store: Annotated[Store, Depends(get_store)],
    csrf: Annotated[CsrfService, Depends(get_csrf_service)],
    tokens: Annotated[TokenService, Depends(get_token_service)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> LoginResponse:
    """Refresh an authenticated browser session.

    Args:
        request: FastAPI request.
        response: FastAPI response.
        store: Application store.
        csrf: CSRF service.
        tokens: Token service.
        settings: Runtime settings.

    Returns:
        Public user and new CSRF token.
    """

    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="refresh_required")
    try:
        claims = tokens.verify(refresh_token, "refresh")
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_refresh",
        ) from exc
    user = await store.get_user(str(claims["sub"]))
    if user is None or not _refresh_claim_matches_user(claims, user):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_user")
    csrf_token = csrf.create_token()
    _set_cookie(response, "access_token", tokens.create_access_token(user.id, csrf_token), settings)
    _set_cookie(
        response,
        "refresh_token",
        tokens.create_refresh_token(user.id, user.refresh_token_version),
        settings,
    )
    _set_cookie(response, "csrf_token", csrf_token, settings, httponly=False)
    return LoginResponse(user=public_user(user), csrf_token=csrf_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    user: Annotated[UserRecord, Depends(current_user)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
    store: Annotated[Store, Depends(get_store)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> None:
    """Clear browser session cookies and record a logout audit event.

    Args:
        response: FastAPI response.
        user: Current authenticated user.
        audit: Audit logger.
        store: Application store.
        settings: Runtime settings.
    """

    await store.update_user(user.next_refresh_token_version())
    _clear_cookie(response, "access_token", settings, httponly=True)
    _clear_cookie(response, "refresh_token", settings, httponly=True)
    _clear_cookie(response, "csrf_token", settings, httponly=False)
    await audit.record(
        actor_id=user.id,
        action="logout",
        target={},
        parameters={},
        outcome="ok",
    )


@router.post("/2fa/setup", response_model=TotpSetupResponse)
async def setup_totp(
    user: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
    totp: Annotated[TotpService, Depends(get_totp_service)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> TotpSetupResponse:
    """Create or rotate a TOTP secret for the current user.

    Args:
        user: Current user.
        store: Application store.
        totp: TOTP service.
        settings: Runtime settings.

    Returns:
        TOTP setup data.
    """

    if user.totp_secret and not user.has_recent_totp(settings.totp_recent_minutes):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="totp_required")
    secret = totp.create_secret()
    updated = user.model_copy(update={"totp_secret": secret, "totp_verified_at": None})
    await store.update_user(updated)
    return TotpSetupResponse(
        secret=secret,
        provisioning_uri=totp.provisioning_uri(user.email, secret),
    )


@router.post("/2fa/verify", response_model=UserPublic)
async def verify_totp(
    payload: TotpVerifyRequest,
    user: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
    totp: Annotated[TotpService, Depends(get_totp_service)],
) -> UserPublic:
    """Verify TOTP for the current user.

    Args:
        payload: TOTP code payload.
        user: Current user.
        store: Application store.
        totp: TOTP service.

    Returns:
        Updated public user.
    """

    if not user.totp_secret or not totp.verify(user.totp_secret, payload.code):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_totp")
    updated = user.model_copy(update={"totp_verified_at": datetime.now(tz=UTC)})
    await store.update_user(updated)
    return public_user(updated)


async def _optional_user(
    request: Request,
    store: Store,
    tokens: TokenService,
) -> UserRecord | None:
    token = request.cookies.get("access_token")
    if not token:
        return None
    try:
        claims = tokens.verify(token, "access")
    except jwt.InvalidTokenError:
        return None
    return await store.get_user(str(claims["sub"]))


def _set_cookie(
    response: Response,
    name: str,
    value: str,
    settings: Settings,
    httponly: bool = True,
) -> None:
    response.set_cookie(
        name,
        value,
        httponly=httponly,
        secure=settings.cookie_secure,
        samesite="strict",
    )


def _clear_cookie(
    response: Response,
    name: str,
    settings: Settings,
    httponly: bool,
) -> None:
    response.delete_cookie(
        name,
        httponly=httponly,
        secure=settings.cookie_secure,
        samesite="strict",
    )


def _refresh_claim_matches_user(claims: dict[str, object], user: UserRecord) -> bool:
    raw_version = claims.get("rv")
    if not isinstance(raw_version, int | str) or isinstance(raw_version, bool):
        return False
    try:
        token_version = int(raw_version)
    except ValueError:
        return False
    return token_version == user.refresh_token_version
