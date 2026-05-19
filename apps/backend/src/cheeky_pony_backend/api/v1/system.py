# SPDX-License-Identifier: AGPL-3.0-only
"""System acknowledgement and lab-safety API routes."""

from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from cheeky_pony_backend.dependencies import (
    current_user,
    get_audit_logger,
    get_store,
    require_admin_2fa,
)
from cheeky_pony_backend.domain.active_gates import AUTHORIZED_OPERATOR_KIND
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_shared import SystemAcknowledgement

router = APIRouter(prefix="/system", tags=["system"])

AUTHORIZED_STATEMENT = "I am authorized to test the listed wireless targets in this engagement."


class AcknowledgementRequest(BaseModel):
    """Authorized-operator acknowledgement request."""

    model_config = ConfigDict(extra="forbid")

    statement: str = Field(min_length=16, max_length=512)


class DemoStatusResponse(BaseModel):
    """Demo data presence summary."""

    synthetic_records: int = Field(ge=0)
    last_seeded_at: datetime | None = None


@router.get("/demo-status", response_model=DemoStatusResponse)
async def demo_status(
    _: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
) -> DemoStatusResponse:
    """Return demo data presence metadata.

    Args:
        _: Current user.
        store: Application store.

    Returns:
        Synthetic record count and last seed timestamp.
    """

    return DemoStatusResponse(
        synthetic_records=await store.count_synthetic_records(),
        last_seeded_at=await store.last_demo_seeded_at(),
    )


@router.post("/acknowledgements", response_model=SystemAcknowledgement)
async def create_authorized_operator_acknowledgement(
    payload: AcknowledgementRequest,
    user: Annotated[UserRecord, Depends(require_admin_2fa)],
    store: Annotated[Store, Depends(get_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
) -> SystemAcknowledgement:
    """Create the one-time authorized-operator acknowledgement.

    Args:
        payload: Typed legal statement.
        user: Current admin with verified TOTP.
        store: Application store.
        audit: Audit logger.

    Returns:
        Stored acknowledgement.
    """

    if payload.statement != AUTHORIZED_STATEMENT:
        await audit.record(user.id, "system.acknowledgement", {}, {}, "denied:statement_mismatch")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="statement_mismatch")
    digest = hashlib.sha256(payload.statement.encode("utf-8")).hexdigest()
    acknowledgement = SystemAcknowledgement(
        kind=AUTHORIZED_OPERATOR_KIND,
        accepted_by=user.id,
        statement_hash=digest,
    )
    await store.create_acknowledgement(acknowledgement)
    await audit.record(user.id, "system.acknowledgement", {}, {}, "accepted")
    return acknowledgement
