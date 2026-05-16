# SPDX-License-Identifier: AGPL-3.0-only
"""Engagement and allow-list API routes for active-operation scoping."""

from __future__ import annotations

from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field

from cheeky_pony_backend.dependencies import get_store, require_admin_2fa
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_shared import Engagement, TargetKind

router = APIRouter(prefix="/engagements", tags=["engagements"])


class EngagementCreateRequest(BaseModel):
    """Engagement creation request."""

    name: str = Field(min_length=1, max_length=128)
    scope_rules: list[dict[str, str]] = Field(default_factory=list)


class AllowTargetRequest(BaseModel):
    """Allow-list target request."""

    kind: TargetKind
    value: str = Field(min_length=1, max_length=128)


@router.post("", response_model=Engagement)
async def create_engagement(
    payload: EngagementCreateRequest,
    _: Annotated[UserRecord, Depends(require_admin_2fa)],
    store: Annotated[Store, Depends(get_store)],
) -> Engagement:
    """Create an engagement.

    Args:
        payload: Engagement payload.
        _: Current admin with verified TOTP.
        store: Application store.

    Returns:
        Created engagement.
    """

    engagement = Engagement(id=str(uuid4()), name=payload.name, scope_rules=payload.scope_rules)
    return await store.create_engagement(engagement)


@router.post("/{engagement_id}/allow-list", status_code=status.HTTP_204_NO_CONTENT)
async def allow_target(
    engagement_id: str,
    payload: AllowTargetRequest,
    _: Annotated[UserRecord, Depends(require_admin_2fa)],
    store: Annotated[Store, Depends(get_store)],
) -> None:
    """Add a target to an engagement allow-list.

    Args:
        engagement_id: Engagement identifier.
        payload: Target payload.
        _: Current admin with verified TOTP.
        store: Application store.
    """

    await store.allow_target(engagement_id, payload.kind, payload.value)
