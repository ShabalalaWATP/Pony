# SPDX-License-Identifier: AGPL-3.0-only
"""LLM insight API routes."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from cheeky_pony_backend.config import Settings, get_settings
from cheeky_pony_backend.dependencies import (
    current_user,
    get_audit_logger,
    get_llm_insight_service,
    get_runtime_flags,
    get_store,
    get_usage_ledger,
)
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.llm.budget import UsageLedger
from cheeky_pony_backend.llm.errors import LlmEntityNotFoundError, LlmInsightUnavailableError
from cheeky_pony_backend.llm.runtime_flags import LlmRuntimeFlags
from cheeky_pony_backend.llm.service import LlmInsightService
from cheeky_pony_backend.llm.types import Insight, InsightKind
from cheeky_pony_backend.llm.usage import LlmUsageResponse, build_usage_response

router = APIRouter(prefix="/insights", tags=["insights"])

RefreshKind = Literal["alert_context", "engagement_summary", "ap_description", "pcap_finding"]


class KillSwitchRequest(BaseModel):
    """Typed-confirm body for runtime LLM kill-switch changes."""

    model_config = ConfigDict(extra="forbid")

    enable: bool
    confirm: Literal["ENABLE", "DISABLE"]


class KillSwitchResponse(BaseModel):
    """Runtime LLM kill-switch state."""

    model_config = ConfigDict(extra="forbid")

    env_enabled: bool
    effective_enabled: bool
    runtime_disabled: bool


@router.get("/alert/{alert_id}", response_model=Insight)
async def get_alert_context_insight(
    alert_id: str,
    user: Annotated[UserRecord, Depends(current_user)],
    service: Annotated[LlmInsightService, Depends(get_llm_insight_service)],
) -> Insight | JSONResponse:
    """Return LLM-generated context for an alert."""

    try:
        return await service.alert_context(alert_id, actor_id=user.id)
    except LlmEntityNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="alert_not_found"
        ) from exc
    except LlmInsightUnavailableError as exc:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"detail": "llm_unavailable", "reason": exc.reason},
        )


@router.get("/engagement/{engagement_id}", response_model=Insight)
async def get_engagement_summary_insight(
    engagement_id: str,
    user: Annotated[UserRecord, Depends(current_user)],
    service: Annotated[LlmInsightService, Depends(get_llm_insight_service)],
) -> Insight | JSONResponse:
    """Return LLM-generated summary for an engagement."""

    try:
        return await service.engagement_summary(engagement_id, actor_id=user.id)
    except LlmEntityNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="engagement_not_found"
        ) from exc
    except LlmInsightUnavailableError as exc:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"detail": "llm_unavailable", "reason": exc.reason},
        )


@router.get("/ap/{bssid}", response_model=Insight)
async def get_ap_description_insight(
    bssid: str,
    user: Annotated[UserRecord, Depends(current_user)],
    service: Annotated[LlmInsightService, Depends(get_llm_insight_service)],
) -> Insight | JSONResponse:
    """Return LLM-generated description for an access point."""

    try:
        return await service.ap_description(bssid, actor_id=user.id)
    except LlmEntityNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="access_point_not_found"
        ) from exc
    except LlmInsightUnavailableError as exc:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"detail": "llm_unavailable", "reason": exc.reason},
        )


@router.get("/pcap-finding/{finding_id}", response_model=Insight)
async def get_pcap_finding_insight(
    finding_id: Annotated[str, Path(min_length=1, max_length=128)],
    user: Annotated[UserRecord, Depends(current_user)],
    service: Annotated[LlmInsightService, Depends(get_llm_insight_service)],
) -> Insight | JSONResponse:
    """Return LLM-generated explanation for a structured PCAP finding."""

    try:
        return await service.pcap_finding(finding_id, actor_id=user.id)
    except LlmEntityNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="pcap_finding_not_found"
        ) from exc
    except LlmInsightUnavailableError as exc:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"detail": "llm_unavailable", "reason": exc.reason},
        )


@router.post("/{kind}/{entity_id}/refresh", response_model=Insight)
async def refresh_insight(
    kind: RefreshKind,
    entity_id: Annotated[str, Path(min_length=1, max_length=128)],
    user: Annotated[UserRecord, Depends(current_user)],
    service: Annotated[LlmInsightService, Depends(get_llm_insight_service)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Insight | JSONResponse:
    """Force fresh generation for one named insight kind."""

    await _require_admin_totp(user, settings, audit, f"llm.insight.{kind}.refresh", entity_id)
    try:
        return await service.refresh(_insight_kind(kind), entity_id, actor_id=user.id)
    except LlmEntityNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="entity_not_found"
        ) from exc
    except LlmInsightUnavailableError as exc:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"detail": "llm_unavailable", "reason": exc.reason},
        )


@router.get("/usage", response_model=LlmUsageResponse)
async def get_llm_usage(
    user: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
    ledger: Annotated[UsageLedger, Depends(get_usage_ledger)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> LlmUsageResponse:
    """Return admin-only LLM usage telemetry."""

    await _require_admin(user, audit, "llm.usage.read", "usage")
    response = await build_usage_response(store, ledger, settings)
    await audit.record(
        user.id,
        "llm.usage.read",
        {"kind": "llm_usage"},
        {"audit_level": "debug", "recent_entries": len(response.recent_audit_entries)},
        "ok",
    )
    return response


@router.post("/kill-switch", response_model=KillSwitchResponse)
async def toggle_llm_kill_switch(
    payload: KillSwitchRequest,
    user: Annotated[UserRecord, Depends(current_user)],
    runtime_flags: Annotated[LlmRuntimeFlags, Depends(get_runtime_flags)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> KillSwitchResponse:
    """Toggle the runtime LLM kill switch after admin, TOTP, and typed confirm."""

    await _require_admin_totp(user, settings, audit, "llm.kill_switch.toggle", "kill_switch")
    expected = "ENABLE" if payload.enable else "DISABLE"
    if payload.confirm != expected:
        await audit.record(
            user.id,
            "llm.kill_switch.toggle",
            {"kind": "llm_runtime"},
            {"enable": payload.enable},
            "denied:confirm_mismatch",
        )
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="confirm_mismatch")
    flag = await runtime_flags.set_llm_disabled(not payload.enable)
    await audit.record(
        user.id,
        "llm.kill_switch.toggle",
        {"kind": "llm_runtime"},
        {"enable": payload.enable, "runtime_disabled": flag.disabled},
        "ok",
    )
    return KillSwitchResponse(
        env_enabled=settings.llm_enabled,
        effective_enabled=settings.llm_enabled and not flag.disabled,
        runtime_disabled=flag.disabled,
    )


async def _require_admin_totp(
    user: UserRecord,
    settings: Settings,
    audit: AuditLogger,
    action: str,
    entity_id: str,
) -> None:
    await _require_admin(user, audit, action, entity_id)
    if user.has_recent_totp(settings.totp_recent_minutes):
        return
    await audit.record(user.id, action, {"id": entity_id}, {}, "denied:totp_required")
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="totp_required")


async def _require_admin(
    user: UserRecord,
    audit: AuditLogger,
    action: str,
    entity_id: str,
) -> None:
    if user.is_admin():
        return
    await audit.record(user.id, action, {"id": entity_id}, {}, "denied:admin_required")
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin_required")


def _insight_kind(kind: RefreshKind) -> InsightKind:
    return kind
