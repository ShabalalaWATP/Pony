# SPDX-License-Identifier: AGPL-3.0-only
"""Authenticated lab-readiness status API route."""

from __future__ import annotations

from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status

from cheeky_pony_backend.config import Settings, get_settings
from cheeky_pony_backend.dependencies import get_audit_logger, get_store, get_token_service
from cheeky_pony_backend.domain.active_gates import AUTHORIZED_OPERATOR_KIND
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.lab import LabStatusResponse
from cheeky_pony_backend.domain.lab_readiness import LabReadinessInput, lab_readiness
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.security import TokenService
from cheeky_pony_shared import Engagement

router = APIRouter(prefix="/lab", tags=["lab"])


@router.get("/status", response_model=LabStatusResponse)
async def get_lab_status(
    user: Annotated[UserRecord, Depends(_current_user_or_audit)],
    store: Annotated[Store, Depends(get_store)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> LabStatusResponse:
    """Return the current active-lab readiness checklist.

    Args:
        user: Current authenticated operator.
        store: Application store.
        settings: Runtime settings.

    Returns:
        Backwards-compatible lab status plus readiness checks.
    """

    acknowledgement = await store.has_acknowledgement(AUTHORIZED_OPERATOR_KIND)
    active_engagement = await store.get_active_engagement()
    allow_list_nonempty = await _active_allow_list_nonempty(store, active_engagement)
    is_admin = user.is_admin()
    is_admin_2fa = is_admin and user.has_recent_totp(settings.totp_recent_minutes)
    readiness = lab_readiness(
        LabReadinessInput(
            lab_mode=settings.lab_mode,
            admin_role=is_admin,
            totp_recent=is_admin_2fa,
            engagement_active=active_engagement is not None,
            authorized_operator=acknowledgement,
            allow_list_nonempty=allow_list_nonempty,
        )
    )
    return LabStatusResponse(
        lab_mode=settings.lab_mode,
        acknowledgement_on_file=acknowledgement,
        is_admin_2fa=is_admin_2fa,
        ready=readiness.ready,
        checks=readiness.checks,
    )


async def _current_user_or_audit(
    request: Request,
    store: Annotated[Store, Depends(get_store)],
    tokens: Annotated[TokenService, Depends(get_token_service)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
) -> UserRecord:
    token = _bearer_token(request) or request.cookies.get("access_token")
    if token is None:
        await _audit_lab_status_denial(audit, "system:anonymous", "authentication_required")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="authentication_required",
        )
    try:
        claims = tokens.verify(token, "access")
    except jwt.InvalidTokenError as exc:
        await _audit_lab_status_denial(audit, "system:anonymous", "invalid_token")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_token",
        ) from exc
    user = await store.get_user(str(claims["sub"]))
    if user is None or user.disabled:
        await _audit_lab_status_denial(audit, str(claims["sub"]), "invalid_user")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_user")
    return user


async def _active_allow_list_nonempty(
    store: Store,
    active_engagement: Engagement | None,
) -> bool:
    if active_engagement is None:
        return False
    _, total = await store.list_allowed_targets(active_engagement.id, 1, 0)
    return total > 0


async def _audit_lab_status_denial(
    audit: AuditLogger,
    actor_id: str,
    reason: str,
) -> None:
    await audit.record(
        actor_id,
        "lab.status.read",
        {},
        {},
        f"denied:{reason}",
    )


def _bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:]
    return None
