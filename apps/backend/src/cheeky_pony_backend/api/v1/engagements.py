# SPDX-License-Identifier: AGPL-3.0-only
"""Engagement and allow-list API routes for active-operation scoping."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field

from cheeky_pony_backend.dependencies import (
    current_user,
    get_audit_logger,
    get_operator_broker,
    get_sensor_command_broker,
    get_store,
    require_admin_2fa,
)
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.infra.operator_broker import OperatorBroker
from cheeky_pony_backend.infra.sensor_command_broker import SensorCommandBroker
from cheeky_pony_shared import (
    AllowedTarget,
    ApiPage,
    CommandKind,
    Engagement,
    SensorCommand,
    TargetKind,
)

router = APIRouter(prefix="/engagements", tags=["engagements"])


class EngagementCreateRequest(BaseModel):
    """Engagement creation request."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=128)
    scope_rules: list[dict[str, str]] = Field(default_factory=list)


class AllowTargetRequest(BaseModel):
    """Allow-list target request."""

    model_config = ConfigDict(extra="forbid")

    kind: TargetKind
    value: str = Field(min_length=1, max_length=128)


@router.post("", response_model=Engagement)
async def create_engagement(
    payload: EngagementCreateRequest,
    user: Annotated[UserRecord, Depends(require_admin_2fa)],
    store: Annotated[Store, Depends(get_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
) -> Engagement:
    """Create an engagement.

    Args:
        payload: Engagement payload.
        user: Current admin with verified TOTP.
        store: Application store.
        audit: Audit logger.

    Returns:
        Created engagement.
    """

    if await store.get_active_engagement() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="active_engagement_exists")
    engagement = Engagement(id=str(uuid4()), name=payload.name, scope_rules=payload.scope_rules)
    created = await store.create_engagement(engagement)
    await audit.record(user.id, "engagement.create", {"engagement_id": created.id}, {}, "ok")
    return created


@router.get("", response_model=ApiPage[Engagement])
async def list_engagements(
    _: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> ApiPage[Engagement]:
    """List engagements.

    Args:
        _: Current user.
        store: Application store.
        limit: Page size.
        offset: Page offset.

    Returns:
        Paginated engagements.
    """

    items, total = await store.list_engagements(limit, offset)
    return ApiPage[Engagement](items=items, total=total, limit=limit, offset=offset)


@router.get("/active", response_model=Engagement)
async def get_active_engagement(
    _: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
) -> Engagement:
    """Return the active engagement.

    Args:
        _: Current user.
        store: Application store.

    Returns:
        Active engagement.
    """

    engagement = await store.get_active_engagement()
    if engagement is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="active_engagement_not_found"
        )
    return engagement


@router.get("/{engagement_id}", response_model=Engagement)
async def get_engagement(
    engagement_id: str,
    _: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
) -> Engagement:
    """Return a single engagement by id.

    Args:
        engagement_id: Engagement identifier.
        _: Current user.
        store: Application store.

    Returns:
        Matching engagement.
    """

    engagement = await store.get_engagement(engagement_id)
    if engagement is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="engagement not found")
    return engagement


@router.post("/{engagement_id}/allow-list", status_code=status.HTTP_204_NO_CONTENT)
async def allow_target(
    engagement_id: str,
    payload: AllowTargetRequest,
    user: Annotated[UserRecord, Depends(require_admin_2fa)],
    store: Annotated[Store, Depends(get_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
) -> None:
    """Add a target to an engagement allow-list.

    Args:
        engagement_id: Engagement identifier.
        payload: Target payload.
        user: Current admin with verified TOTP.
        store: Application store.
        audit: Audit logger.
    """

    await _get_engagement_or_404(store, engagement_id)
    await store.allow_target(engagement_id, payload.kind, payload.value)
    await audit.record(
        user.id,
        "engagement.allow_list.add",
        {"engagement_id": engagement_id, "kind": payload.kind.value, "value": payload.value},
        {},
        "ok",
    )


@router.get("/{engagement_id}/allow-list", response_model=ApiPage[AllowedTarget])
async def list_allowed_targets(
    engagement_id: str,
    _: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> ApiPage[AllowedTarget]:
    """List targets allowed for an engagement.

    Args:
        engagement_id: Engagement identifier.
        _: Current user.
        store: Application store.
        limit: Page size.
        offset: Page offset.

    Returns:
        Paginated allowed targets.
    """

    await _get_engagement_or_404(store, engagement_id)
    items, total = await store.list_allowed_targets(engagement_id, limit, offset)
    return ApiPage[AllowedTarget](items=items, total=total, limit=limit, offset=offset)


@router.delete("/{engagement_id}/allow-list", status_code=status.HTTP_204_NO_CONTENT)
async def remove_allowed_target(
    engagement_id: str,
    payload: AllowTargetRequest,
    user: Annotated[UserRecord, Depends(require_admin_2fa)],
    store: Annotated[Store, Depends(get_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
) -> None:
    """Remove a target from an engagement allow-list.

    Args:
        engagement_id: Engagement identifier.
        payload: Target payload.
        user: Current admin with verified TOTP.
        store: Application store.
        audit: Audit logger.
    """

    await _get_engagement_or_404(store, engagement_id)
    await store.remove_allowed_target(engagement_id, payload.kind, payload.value)
    await audit.record(
        user.id,
        "engagement.allow_list.remove",
        {"engagement_id": engagement_id, "kind": payload.kind.value, "value": payload.value},
        {},
        "ok",
    )


@router.post("/{engagement_id}/resume", response_model=Engagement)
async def resume_engagement(
    engagement_id: str,
    user: Annotated[UserRecord, Depends(require_admin_2fa)],
    store: Annotated[Store, Depends(get_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
) -> Engagement:
    """Resume an ended engagement when no other engagement is active.

    Args:
        engagement_id: Engagement identifier.
        user: Current admin with verified TOTP.
        store: Application store.
        audit: Audit logger.

    Returns:
        Resumed engagement.
    """

    engagement = await _get_engagement_or_404(store, engagement_id)
    active = await store.get_active_engagement()
    if active is not None and active.id != engagement_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="active_engagement_exists")
    resumed = await store.update_engagement(engagement.model_copy(update={"ended_at": None}))
    await audit.record(user.id, "engagement.resume", {"engagement_id": engagement_id}, {}, "ok")
    return resumed


@router.post("/{engagement_id}/end", status_code=status.HTTP_204_NO_CONTENT)
async def end_engagement(
    engagement_id: str,
    user: Annotated[UserRecord, Depends(require_admin_2fa)],
    store: Annotated[Store, Depends(get_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
    command_broker: Annotated[SensorCommandBroker, Depends(get_sensor_command_broker)],
    operator_broker: Annotated[OperatorBroker, Depends(get_operator_broker)],
) -> None:
    """End an engagement and cancel scoped lab commands.

    Args:
        engagement_id: Engagement identifier.
        user: Current admin with verified TOTP.
        store: Application store.
        audit: Audit logger.
        command_broker: Sensor command broker.
        operator_broker: Operator broker.
    """

    engagement = await _get_engagement_or_404(store, engagement_id)
    ended_at = datetime.now(tz=UTC)
    await store.update_engagement(engagement.model_copy(update={"ended_at": ended_at}))
    records = await command_broker.stop_lab_commands_for_engagement(engagement_id)
    for record in records:
        audit_entry = await audit.record(
            user.id,
            f"lab.{record.module}.stop",
            {"engagement_id": engagement_id, "command_id": record.command_id},
            {"reason": "engagement_ended"},
            "cancelled",
            started_at=record.started_at,
            finished_at=ended_at,
        )
        await command_broker.send(
            record.sensor_id, _stop_module_command(record.command_id, record.module)
        )
        await operator_broker.broadcast(
            {
                "kind": "lab.stopped",
                "command_id": record.command_id,
                "module": record.module,
                "sensor_id": record.sensor_id,
                "outcome": "cancelled",
                "finished_at": ended_at.isoformat(),
                "audit_id": audit_entry.id,
            }
        )
    await audit.record(user.id, "engagement.end", {"engagement_id": engagement_id}, {}, "ok")


def _stop_module_command(command_id: str, module: str) -> SensorCommand:
    return SensorCommand(
        id=command_id,
        kind=CommandKind.STOP_MODULE,
        parameters={"module": module.replace("-", "_")},
        lab_mode=True,
    )


async def _get_engagement_or_404(store: Store, engagement_id: str) -> Engagement:
    engagement = await store.get_engagement(engagement_id)
    if engagement is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="engagement_not_found")
    return engagement
