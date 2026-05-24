# SPDX-License-Identifier: AGPL-3.0-only
"""Authentication and TOTP API routes."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import uuid4

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from cheeky_pony_backend.api.v1.auth_audit import ANONYMOUS_ACTOR, audit_auth
from cheeky_pony_backend.api.v1.auth_session import (
    bearer_token,
    clear_cookie,
    optional_user,
    refresh_claim_matches_user,
    set_cookie,
)
from cheeky_pony_backend.config import Settings, get_settings
from cheeky_pony_backend.dependencies import (
    check_account_auth_rate_limit,
    check_auth_rate_limit,
    current_user,
    get_audit_logger,
    get_csrf_service,
    get_password_service,
    get_store,
    get_token_service,
    get_totp_service,
    reset_account_auth_rate_limit,
)
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.users import UserRecord, public_user
from cheeky_pony_backend.security import CsrfService, PasswordService, TokenService, TotpService
from cheeky_pony_shared import UserPublic

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    """User registration request."""

    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str = Field(min_length=12, max_length=256)


class LoginRequest(BaseModel):
    """User login request."""

    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class TotpSetupResponse(BaseModel):
    """TOTP setup response."""

    secret: str
    provisioning_uri: str


class TotpVerifyRequest(BaseModel):
    """TOTP verification request."""

    model_config = ConfigDict(extra="forbid")

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
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
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

    email = str(payload.email).lower()
    if await store.get_user_by_email(email):
        await audit_auth(audit, "auth.register", "denied:duplicate_email", email)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="email_exists")
    roles = ["admin"] if await store.count_users() == 0 else ["operator"]
    actor: UserRecord | str | None = None
    if roles == ["admin"] and settings.bootstrap_token is None:
        await audit_auth(audit, "auth.register", "denied:bootstrap_disabled", email)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="bootstrap_disabled",
        )
    if roles == ["admin"] and bearer_token(request) != settings.bootstrap_token:
        await audit_auth(audit, "auth.register", "denied:invalid_bootstrap_token", email)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_bootstrap")
    if roles != ["admin"]:
        user = await optional_user(request, store, tokens)
        if (
            user is None
            or not user.is_admin()
            or not user.has_recent_totp(settings.totp_recent_minutes)
        ):
            await audit_auth(audit, "auth.register", "denied:not_first_admin", email, user)
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin_2fa_required")
        actor = user
    user = UserRecord(
        id=str(uuid4()),
        email=email,
        password_hash=passwords.hash_password(payload.password),
        roles=roles,
    )
    await store.create_user(user)
    await audit_auth(
        audit,
        "auth.register",
        "ok",
        email,
        actor or user,
        target_user_id=user.id,
        parameters={"roles": roles},
    )
    return public_user(user)


@router.post("/login", response_model=LoginResponse, dependencies=[Depends(check_auth_rate_limit)])
async def login(
    payload: LoginRequest,
    response: Response,
    store: Annotated[Store, Depends(get_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
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

    email = str(payload.email).lower()
    try:
        check_account_auth_rate_limit(email)
    except HTTPException:
        await audit_auth(audit, "auth.login", "denied:rate_limited", email)
        raise
    user = await store.get_user_by_email(email)
    if user is None or not passwords.verify(user.password_hash, payload.password):
        await audit_auth(audit, "auth.login", "denied:invalid_credentials", email)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_credentials")
    if user.disabled:
        await audit_auth(
            audit,
            "auth.login",
            "denied:invalid_user",
            email,
            user,
            target_user_id=user.id,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_user")
    csrf_token = csrf.create_token()
    set_cookie(response, "access_token", tokens.create_access_token(user.id, csrf_token), settings)
    set_cookie(
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
    reset_account_auth_rate_limit(email)
    await audit_auth(audit, "auth.login", "ok", email, user, target_user_id=user.id)
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
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
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
        await audit_auth(audit, "auth.refresh", "denied:refresh_required")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="refresh_required")
    try:
        claims = tokens.verify(refresh_token, "refresh")
    except jwt.InvalidTokenError as exc:
        await audit_auth(audit, "auth.refresh", "denied:invalid_refresh")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_refresh",
        ) from exc
    user = await store.get_user(str(claims["sub"]))
    if user is None or user.disabled or not refresh_claim_matches_user(claims, user):
        await audit_auth(
            audit,
            "auth.refresh",
            "denied:invalid_user",
            actor=str(claims.get("sub", ANONYMOUS_ACTOR)),
            target_user_id=str(claims.get("sub", "")),
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_user")
    csrf_token = csrf.create_token()
    set_cookie(response, "access_token", tokens.create_access_token(user.id, csrf_token), settings)
    set_cookie(
        response,
        "refresh_token",
        tokens.create_refresh_token(user.id, user.refresh_token_version),
        settings,
    )
    set_cookie(response, "csrf_token", csrf_token, settings, httponly=False)
    await audit_auth(audit, "auth.refresh", "ok", user.email, user, target_user_id=user.id)
    return LoginResponse(user=public_user(user), csrf_token=csrf_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    response: Response,
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
    store: Annotated[Store, Depends(get_store)],
    tokens: Annotated[TokenService, Depends(get_token_service)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> None:
    """Clear browser session cookies and record a logout audit event.

    Args:
        response: FastAPI response.
        audit: Audit logger.
        store: Application store.
        tokens: Token service.
        settings: Runtime settings.
    """
    user = await optional_user(request, store, tokens)
    if user is None:
        refresh_token = request.cookies.get("refresh_token")
        if refresh_token:
            try:
                claims = tokens.verify(refresh_token, "refresh")
            except jwt.InvalidTokenError:
                claims = None
            if claims is not None:
                candidate = await store.get_user(str(claims["sub"]))
                if candidate is not None and refresh_claim_matches_user(claims, candidate):
                    user = candidate
    if user is not None:
        await store.update_user(user.next_refresh_token_version())
    clear_cookie(response, "access_token", settings, httponly=True)
    clear_cookie(response, "refresh_token", settings, httponly=True)
    clear_cookie(response, "csrf_token", settings, httponly=False)
    actor_id = ANONYMOUS_ACTOR if user is None else user.id
    await audit.record(
        actor_id=actor_id,
        action="logout",
        target={},
        parameters={},
        outcome="ok",
    )


@router.post(
    "/2fa/setup",
    response_model=TotpSetupResponse,
    dependencies=[Depends(check_auth_rate_limit)],
)
async def setup_totp(
    user: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
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

    reset = user.totp_secret is not None
    if reset and not user.has_recent_totp(settings.totp_recent_minutes):
        await audit_auth(
            audit,
            "auth.2fa.setup",
            "denied:totp_required",
            user.email,
            user,
            user.id,
            {"reset": True},
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="totp_required")
    secret = totp.create_secret()
    updated = user.model_copy(update={"totp_secret": secret, "totp_verified_at": None})
    await store.update_user(updated)
    await audit_auth(
        audit,
        "auth.2fa.setup",
        "ok",
        user.email,
        user,
        user.id,
        {"reset": reset},
    )
    return TotpSetupResponse(
        secret=secret,
        provisioning_uri=totp.provisioning_uri(user.email, secret),
    )


@router.post(
    "/2fa/verify",
    response_model=UserPublic,
    dependencies=[Depends(check_auth_rate_limit)],
)
async def verify_totp(
    payload: TotpVerifyRequest,
    user: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
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
        await audit_auth(audit, "auth.2fa.verify", "denied:invalid_totp", user.email, user, user.id)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_totp")
    updated = user.model_copy(update={"totp_verified_at": datetime.now(tz=UTC)})
    await store.update_user(updated)
    await audit_auth(audit, "auth.2fa.verify", "ok", user.email, user, user.id)
    return public_user(updated)
