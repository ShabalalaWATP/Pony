# SPDX-License-Identifier: AGPL-3.0-only
"""Audit log query API routes with no delete operations."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from cheeky_pony_backend.dependencies import get_store, require_admin_2fa
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_shared import ApiPage, AuditLog

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=ApiPage[AuditLog])
async def list_audit(
    _: Annotated[UserRecord, Depends(require_admin_2fa)],
    store: Annotated[Store, Depends(get_store)],
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> ApiPage[AuditLog]:
    """List audit entries.

    Args:
        _: Current admin with verified TOTP.
        store: Application store.
        limit: Page size.
        offset: Page offset.

    Returns:
        Paginated audit entries.
    """

    items, total = await store.list_audit(limit, offset)
    return ApiPage[AuditLog](items=items, total=total, limit=limit, offset=offset)
