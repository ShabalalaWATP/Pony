# SPDX-License-Identifier: AGPL-3.0-only
"""Engagement report request, status, and download routes."""

from __future__ import annotations

import base64
from typing import Annotated
from urllib.parse import quote
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, status

from cheeky_pony_backend.config import Settings, get_settings
from cheeky_pony_backend.dependencies import (
    current_user,
    get_audit_logger,
    get_store,
    require_admin_2fa,
)
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.reports import (
    ReportCreateRequest,
    ReportCreateResponse,
    ReportRecord,
    ReportStatus,
    ReportStatusResponse,
    sign_report_download,
    verify_report_download_token,
)
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.workers.tasks import generate_report

router = APIRouter(prefix="/engagements/{engagement_id}/reports", tags=["reports"])


@router.post(
    "",
    response_model=ReportCreateResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_report(
    engagement_id: str,
    payload: ReportCreateRequest,
    background_tasks: BackgroundTasks,
    user: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ReportCreateResponse:
    """Create an engagement report request.

    Args:
        engagement_id: Engagement identifier.
        payload: Report request body.
        background_tasks: FastAPI background task collector.
        user: Current user.
        store: Application store.
        audit: Audit logger.
        settings: Runtime settings.

    Returns:
        Created report identifier and initial status.
    """

    await _require_report_admin_2fa(user, settings, audit, engagement_id, payload)
    engagement = await store.get_engagement(engagement_id)
    if engagement is None:
        await audit.record(
            user.id,
            "reports.create",
            {"engagement_id": engagement_id},
            payload.model_dump(mode="json"),
            "denied:engagement_not_found",
        )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="engagement_not_found")
    report = ReportRecord(
        id=str(uuid4()),
        engagement_id=engagement_id,
        requested_by=user.id,
        format=payload.format,
        since=payload.since,
        until=payload.until,
    )
    await store.create_report(report)
    await audit.record(
        user.id,
        "reports.create",
        {"engagement_id": engagement_id, "report_id": report.id},
        payload.model_dump(mode="json"),
        "pending",
    )
    background_tasks.add_task(generate_report, {"store": store}, report.id)
    return ReportCreateResponse(report_id=report.id, status=ReportStatus.PENDING)


@router.get("/{report_id}", response_model=ReportStatusResponse)
async def get_report_status(
    engagement_id: str,
    report_id: str,
    _: Annotated[UserRecord, Depends(require_admin_2fa)],
    store: Annotated[Store, Depends(get_store)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ReportStatusResponse:
    """Return report generation status.

    Args:
        engagement_id: Engagement identifier.
        report_id: Report identifier.
        _: Current user.
        store: Application store.
        settings: Runtime settings.

    Returns:
        Report status response with a signed download URL when ready.
    """

    report = await _report_or_404(store, engagement_id, report_id)
    if report.status != ReportStatus.READY:
        return ReportStatusResponse(status=report.status, error=report.error)
    token = sign_report_download(
        report_id,
        engagement_id,
        settings.jwt_secret,
        settings.report_download_token_minutes,
    )
    return ReportStatusResponse(
        status=report.status,
        download_url=(
            f"/api/v1/engagements/{engagement_id}/reports/{report_id}/download?token={quote(token)}"
        ),
    )


@router.get(
    "/{report_id}/download",
    response_class=Response,
    responses={200: {"content": {"application/octet-stream": {}}}},
)
async def download_report(
    engagement_id: str,
    report_id: str,
    _: Annotated[UserRecord, Depends(require_admin_2fa)],
    store: Annotated[Store, Depends(get_store)],
    settings: Annotated[Settings, Depends(get_settings)],
    token: str = Query(min_length=1),
) -> Response:
    """Download a ready report through a signed URL.

    Args:
        engagement_id: Engagement identifier.
        report_id: Report identifier.
        _: Current user.
        store: Application store.
        settings: Runtime settings.
        token: Signed download token.

    Returns:
        Report file response.
    """

    report = await _report_or_404(store, engagement_id, report_id)
    if report.status != ReportStatus.READY or report.content_b64 is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="report_not_ready")
    if not verify_report_download_token(token, report_id, engagement_id, settings.jwt_secret):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="invalid_report_token")
    content = base64.b64decode(report.content_b64.encode())
    headers = {"Content-Disposition": f'attachment; filename="{report.filename or report.id}"'}
    return Response(content, media_type=report.content_type, headers=headers)


async def _require_report_admin_2fa(
    user: UserRecord,
    settings: Settings,
    audit: AuditLogger,
    engagement_id: str,
    payload: ReportCreateRequest,
) -> None:
    if user.is_admin() and user.has_recent_totp(settings.totp_recent_minutes):
        return
    await audit.record(
        user.id,
        "reports.create",
        {"engagement_id": engagement_id},
        payload.model_dump(mode="json"),
        "denied:admin_2fa_required",
    )
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin_2fa_required")


async def _report_or_404(store: Store, engagement_id: str, report_id: str) -> ReportRecord:
    report = await store.get_report(engagement_id, report_id)
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="report_not_found")
    return report
