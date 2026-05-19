# SPDX-License-Identifier: AGPL-3.0-only
"""Admin user-management API routes."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field

from cheeky_pony_backend.dependencies import get_audit_logger, get_store, require_admin_2fa
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.users import (
    ALLOWED_USER_ROLES,
    LastAdminDemotionError,
    UserRecord,
    normalize_roles,
    public_user,
)
from cheeky_pony_shared import ApiPage, UserPublic

router = APIRouter(prefix="/users", tags=["users"])
ROLE_SCHEMA_EXTRA: dict[str, Any] = {
    "anyOf": [
        {
            "items": {"enum": sorted(ALLOWED_USER_ROLES), "type": "string"},
            "type": "array",
        },
        {"type": "null"},
    ],
}


class UserUpdateRequest(BaseModel):
    """Admin user update request."""

    model_config = ConfigDict(extra="forbid")

    roles: list[str] | None = Field(
        default=None,
        json_schema_extra=ROLE_SCHEMA_EXTRA,
    )
    reset_totp: bool = False


@router.get("", response_model=ApiPage[UserPublic])
async def list_users(
    _: Annotated[UserRecord, Depends(require_admin_2fa)],
    store: Annotated[Store, Depends(get_store)],
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> ApiPage[UserPublic]:
    """List users for admin settings.

    Args:
        _: Current admin with verified TOTP.
        store: Application store.
        limit: Page size.
        offset: Page offset.

    Returns:
        Paginated public users.
    """

    users, total = await store.list_users(limit, offset)
    return ApiPage[UserPublic](
        items=[public_user(user) for user in users],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.patch("/{user_id}", response_model=UserPublic)
async def update_user(
    user_id: str,
    payload: UserUpdateRequest,
    actor: Annotated[UserRecord, Depends(require_admin_2fa)],
    store: Annotated[Store, Depends(get_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
) -> UserPublic:
    """Update roles or reset TOTP for one user.

    Args:
        user_id: Target user identifier.
        payload: Requested update.
        actor: Current admin with verified TOTP.
        store: Application store.
        audit: Audit logger.

    Returns:
        Updated public user.
    """

    parameters = payload.model_dump(exclude_unset=True, mode="json")
    try:
        roles = None if payload.roles is None else normalize_roles(payload.roles)
    except ValueError as exc:
        await _audit_denial(audit, actor, user_id, parameters, "invalid_role")
        raise HTTPException(status_code=422, detail="invalid_role") from exc
    if roles is not None:
        parameters["roles"] = roles

    try:
        updated = await store.update_user_access(user_id, roles, payload.reset_totp, actor.id)
    except LastAdminDemotionError as exc:
        await _audit_denial(audit, actor, user_id, parameters, "last_admin")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="last_admin") from exc
    if updated is None:
        await _audit_denial(audit, actor, user_id, parameters, "not_found")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user_not_found")

    await audit.record(actor.id, "user.update", {"user_id": user_id}, parameters, "ok")
    return public_user(updated)


async def _audit_denial(
    audit: AuditLogger,
    actor: UserRecord,
    user_id: str,
    parameters: dict[str, Any],
    reason: str,
) -> None:
    await audit.record(
        actor.id,
        "user.update",
        {"user_id": user_id},
        parameters,
        f"denied:{reason}",
    )
