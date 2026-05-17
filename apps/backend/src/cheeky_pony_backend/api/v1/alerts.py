# SPDX-License-Identifier: AGPL-3.0-only
"""Alert and alert-rule API routes."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator

from cheeky_pony_backend.dependencies import (
    current_user,
    get_audit_logger,
    get_store,
    require_admin_2fa,
)
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_shared import Alert, AlertRule, AlertSeverity, ApiPage, EventKind

router = APIRouter(prefix="/alerts", tags=["alerts"])


class AlertRuleCreateRequest(BaseModel):
    """Alert rule creation request."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=512)
    severity: AlertSeverity
    enabled: bool = True
    predicate: dict[str, Any]

    @field_validator("predicate")
    @classmethod
    def validate_predicate(cls, value: dict[str, Any]) -> dict[str, Any]:
        """Validate v1 predicate JSON.

        Args:
            value: Predicate JSON.

        Returns:
            Validated predicate.
        """

        return _validate_predicate(value)


class AlertRuleUpdateRequest(BaseModel):
    """Alert rule update request."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=512)
    severity: AlertSeverity | None = None
    enabled: bool | None = None
    predicate: dict[str, Any] | None = None

    @field_validator("predicate")
    @classmethod
    def validate_predicate(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        """Validate v1 predicate JSON when supplied.

        Args:
            value: Predicate JSON.

        Returns:
            Validated predicate.
        """

        return None if value is None else _validate_predicate(value)


@router.get("", response_model=ApiPage[Alert])
async def list_alerts(
    _: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
    severity: Annotated[list[AlertSeverity] | None, Query()] = None,
    acked: Annotated[bool | None, Query()] = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> ApiPage[Alert]:
    """List alerts with severity and acknowledgement filters.

    Args:
        _: Current user.
        store: Application store.
        severity: Optional repeated severity filter.
        acked: Optional acknowledgement-state filter.
        limit: Page size.
        offset: Page offset.

    Returns:
        Paginated alert list.
    """

    items, total = await store.list_alerts(limit, offset, severity, acked)
    return ApiPage[Alert](items=items, total=total, limit=limit, offset=offset)


@router.get("/rules", response_model=ApiPage[AlertRule])
async def list_alert_rules(
    _: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> ApiPage[AlertRule]:
    """List alert rules.

    Args:
        _: Current user.
        store: Application store.
        limit: Page size.
        offset: Page offset.

    Returns:
        Paginated alert-rule list.
    """

    items, total = await store.list_alert_rules(limit, offset)
    return ApiPage[AlertRule](items=items, total=total, limit=limit, offset=offset)


@router.post("/rules", response_model=AlertRule)
async def create_alert_rule(
    payload: AlertRuleCreateRequest,
    user: Annotated[UserRecord, Depends(require_admin_2fa)],
    store: Annotated[Store, Depends(get_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
) -> AlertRule:
    """Create an alert rule.

    Args:
        payload: Rule payload.
        user: Current admin with verified TOTP.
        store: Application store.
        audit: Audit logger.

    Returns:
        Created alert rule.
    """

    rule = AlertRule(id=str(uuid4()), created_by=user.id, **payload.model_dump(mode="json"))
    saved = await store.create_alert_rule(rule)
    await audit.record(
        user.id, "alerts.rules.create", {"rule_id": saved.id}, payload.model_dump(mode="json"), "ok"
    )
    return saved


@router.patch("/rules/{rule_id}", response_model=AlertRule)
async def update_alert_rule(
    rule_id: str,
    payload: AlertRuleUpdateRequest,
    user: Annotated[UserRecord, Depends(require_admin_2fa)],
    store: Annotated[Store, Depends(get_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
) -> AlertRule:
    """Update an alert rule.

    Args:
        rule_id: Alert rule identifier.
        payload: Rule update payload.
        user: Current admin with verified TOTP.
        store: Application store.
        audit: Audit logger.

    Returns:
        Updated alert rule.
    """

    existing = await _get_rule_or_404(store, rule_id)
    changes = payload.model_dump(exclude_unset=True, mode="json")
    saved = await store.update_alert_rule(existing.model_copy(update=changes))
    await audit.record(user.id, "alerts.rules.update", {"rule_id": saved.id}, changes, "ok")
    return saved


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alert_rule(
    rule_id: str,
    user: Annotated[UserRecord, Depends(require_admin_2fa)],
    store: Annotated[Store, Depends(get_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
) -> None:
    """Delete an alert rule.

    Args:
        rule_id: Alert rule identifier.
        user: Current admin with verified TOTP.
        store: Application store.
        audit: Audit logger.
    """

    await _get_rule_or_404(store, rule_id)
    await store.delete_alert_rule(rule_id)
    await audit.record(user.id, "alerts.rules.delete", {"rule_id": rule_id}, {}, "ok")


@router.post("/{alert_id}/ack", status_code=status.HTTP_204_NO_CONTENT)
async def ack_alert(
    alert_id: str,
    user: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
) -> None:
    """Acknowledge an alert.

    Args:
        alert_id: Alert identifier.
        user: Current user.
        store: Application store.
        audit: Audit logger.
    """

    alert = await store.get_alert(alert_id)
    if alert is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="alert_not_found")
    updated = alert.model_copy(update={"acked_by": user.id, "acked_at": datetime.now(tz=UTC)})
    await store.update_alert(updated)
    await audit.record(user.id, "alerts.ack", {"alert_id": alert_id}, {}, "ok")


async def _get_rule_or_404(store: Store, rule_id: str) -> AlertRule:
    rule = await store.get_alert_rule(rule_id)
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="alert_rule_not_found")
    return rule


def _validate_predicate(value: dict[str, Any]) -> dict[str, Any]:
    unknown = set(value) - {"event_kind", "match", "watch"}
    if unknown:
        raise ValueError("predicate contains unsupported keys")
    if "event_kind" in value:
        EventKind(str(value["event_kind"]))
    _validate_match(value.get("match"))
    _validate_watch(value.get("watch"))
    if not any(key in value for key in ("event_kind", "match", "watch")):
        raise ValueError("predicate must contain event_kind, match, or watch")
    return value


def _validate_match(value: object) -> None:
    if value is None:
        return
    if not isinstance(value, dict) or not value:
        raise ValueError("predicate.match must be a non-empty object")
    for key, pattern in value.items():
        if not isinstance(key, str) or not isinstance(pattern, str) or len(pattern) > 256:
            raise ValueError("predicate.match values must be short strings")


def _validate_watch(value: object) -> None:
    if value is None:
        return
    if not isinstance(value, list) or not value:
        raise ValueError("predicate.watch must be a non-empty list")
    if any(not isinstance(item, str) or len(item) > 128 for item in value):
        raise ValueError("predicate.watch values must be short strings")
