# SPDX-License-Identifier: AGPL-3.0-only
"""PCAP analysis and findings API routes."""

from __future__ import annotations

from typing import Annotated
from uuid import uuid4

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status

from cheeky_pony_backend.api.v1.pcap_common import (
    audit_refusal,
    engagement_or_refuse,
    pcap_or_refuse,
    pcap_target,
    pcap_user,
    require_admin_2fa,
)
from cheeky_pony_backend.config import Settings, get_settings
from cheeky_pony_backend.dependencies import (
    check_auth_rate_limit,
    get_audit_logger,
    get_pcap_analysis_store,
    get_pcap_store,
    get_store,
    get_tshark_runtime,
)
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.pcap_models import PcapAnalysisClaimStatus, PcapStatus
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.infra.pcap_analysis_store import PcapAnalysisStore
from cheeky_pony_backend.infra.pcap_store import PcapStore
from cheeky_pony_backend.pcap.findings import (
    AnalysisStartResponse,
    AnalysisSummaryResponse,
    Finding,
    redact_lab_gated_evidence,
)
from cheeky_pony_backend.pcap.tshark import TsharkRunner
from cheeky_pony_backend.workers.tasks import analyze_pcap_capture
from cheeky_pony_shared import ApiPage

router = APIRouter(prefix="/engagements/{engagement_id}/pcaps", tags=["pcaps"])


@router.post(
    "/{pcap_id}/analyze",
    response_model=AnalysisStartResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(check_auth_rate_limit)],
)
async def analyze_pcap(
    engagement_id: str,
    pcap_id: str,
    background_tasks: BackgroundTasks,
    user: Annotated[UserRecord, Depends(pcap_user)],
    store: Annotated[Store, Depends(get_store)],
    pcaps: Annotated[PcapStore, Depends(get_pcap_store)],
    analysis_store: Annotated[PcapAnalysisStore, Depends(get_pcap_analysis_store)],
    runtime: Annotated[TsharkRunner, Depends(get_tshark_runtime)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AnalysisStartResponse:
    """Queue analysis for one uploaded capture."""

    target = {"engagement_id": engagement_id, "pcap_id": pcap_id}
    await require_admin_2fa(user, settings, audit, "pcap.analyze.start", target)
    await engagement_or_refuse(store, audit, user, engagement_id, "pcap.analyze.start")
    claim = await pcaps.begin_analysis(engagement_id, pcap_id)
    if claim.status == PcapAnalysisClaimStatus.NOT_FOUND:
        await audit_refusal(audit, user, "pcap.analyze.start", target, "not_found")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="pcap_not_found")
    if claim.status == PcapAnalysisClaimStatus.BUSY:
        await audit_refusal(audit, user, "pcap.analyze.start", target, "analysis_in_progress")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="analysis_in_progress")
    if claim.pcap is None:
        await audit_refusal(audit, user, "pcap.analyze.start", target, "claim_failed")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="analysis_claim_failed")

    analysis_id = str(uuid4())
    try:
        await _dispatch_analysis(
            background_tasks,
            settings,
            pcaps,
            analysis_store,
            runtime,
            store,
            engagement_id,
            pcap_id,
            user.id,
            analysis_id,
        )
    except Exception as exc:
        await pcaps.update_pcap_status(engagement_id, pcap_id, PcapStatus.FAILED)
        await audit_refusal(audit, user, "pcap.analyze.start", target, "queue_unavailable")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="analysis_queue_unavailable",
        ) from exc
    await audit.record(
        user.id,
        "pcap.analyze.start",
        {**pcap_target(claim.pcap), "analysis_id": analysis_id},
        {},
        "queued",
    )
    return AnalysisStartResponse(analysis_id=analysis_id)


@router.get("/{pcap_id}/analysis", response_model=AnalysisSummaryResponse)
async def get_analysis(
    engagement_id: str,
    pcap_id: str,
    user: Annotated[UserRecord, Depends(pcap_user)],
    store: Annotated[Store, Depends(get_store)],
    pcaps: Annotated[PcapStore, Depends(get_pcap_store)],
    analysis_store: Annotated[PcapAnalysisStore, Depends(get_pcap_analysis_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
) -> AnalysisSummaryResponse:
    """Return current analysis status and finding counts."""

    await engagement_or_refuse(store, audit, user, engagement_id, "pcap.analysis.read")
    await pcap_or_refuse(pcaps, audit, user, engagement_id, pcap_id, "pcap.analysis.read")
    analysis = await analysis_store.latest_run(engagement_id, pcap_id)
    counts = await analysis_store.finding_counts(engagement_id, pcap_id)
    await audit.record(
        user.id,
        "pcap.analysis.read",
        {"engagement_id": engagement_id, "pcap_id": pcap_id},
        {"audit_level": "debug"},
        "ok",
    )
    return AnalysisSummaryResponse(analysis=analysis, finding_counts=counts)


@router.get(
    "/{pcap_id}/findings",
    response_model=ApiPage[Finding],
    response_model_exclude_none=True,
)
async def list_findings(
    engagement_id: str,
    pcap_id: str,
    user: Annotated[UserRecord, Depends(pcap_user)],
    store: Annotated[Store, Depends(get_store)],
    pcaps: Annotated[PcapStore, Depends(get_pcap_store)],
    analysis_store: Annotated[PcapAnalysisStore, Depends(get_pcap_analysis_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
    settings: Annotated[Settings, Depends(get_settings)],
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> ApiPage[Finding]:
    """List structured findings for one capture."""

    await engagement_or_refuse(store, audit, user, engagement_id, "pcap.findings.list")
    await pcap_or_refuse(pcaps, audit, user, engagement_id, pcap_id, "pcap.findings.list")
    findings, total = await analysis_store.list_findings(engagement_id, pcap_id, limit, offset)
    await audit.record(
        user.id,
        "pcap.findings.list",
        {"engagement_id": engagement_id, "pcap_id": pcap_id},
        {"audit_level": "debug", "limit": limit, "offset": offset, "returned": len(findings)},
        "ok",
    )
    return ApiPage[Finding](
        items=[redact_lab_gated_evidence(item, lab_mode=settings.lab_mode) for item in findings],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{pcap_id}/findings/{finding_id}",
    response_model=Finding,
    response_model_exclude_none=True,
)
async def get_finding(
    engagement_id: str,
    pcap_id: str,
    finding_id: str,
    user: Annotated[UserRecord, Depends(pcap_user)],
    store: Annotated[Store, Depends(get_store)],
    pcaps: Annotated[PcapStore, Depends(get_pcap_store)],
    analysis_store: Annotated[PcapAnalysisStore, Depends(get_pcap_analysis_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Finding:
    """Return one structured finding."""

    await engagement_or_refuse(store, audit, user, engagement_id, "pcap.finding.read")
    await pcap_or_refuse(pcaps, audit, user, engagement_id, pcap_id, "pcap.finding.read")
    finding = await analysis_store.get_finding(engagement_id, pcap_id, finding_id)
    if finding is None:
        await audit_refusal(
            audit,
            user,
            "pcap.finding.read",
            {"engagement_id": engagement_id, "pcap_id": pcap_id, "finding_id": finding_id},
            "not_found",
        )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="finding_not_found")
    await audit.record(
        user.id,
        "pcap.finding.read",
        {"engagement_id": engagement_id, "pcap_id": pcap_id, "finding_id": finding_id},
        {"audit_level": "debug"},
        "ok",
    )
    return redact_lab_gated_evidence(finding, lab_mode=settings.lab_mode)


async def _dispatch_analysis(
    background_tasks: BackgroundTasks,
    settings: Settings,
    pcaps: PcapStore,
    analysis_store: PcapAnalysisStore,
    runtime: TsharkRunner,
    store: Store,
    engagement_id: str,
    pcap_id: str,
    actor_id: str,
    analysis_id: str,
) -> None:
    if settings.env == "test" or settings.use_in_memory_store:
        background_tasks.add_task(
            analyze_pcap_capture,
            {
                "pcap_store": pcaps,
                "pcap_analysis_store": analysis_store,
                "settings": settings,
                "store": store,
                "tshark_runtime": runtime,
            },
            engagement_id,
            pcap_id,
            actor_id,
            analysis_id,
        )
        return
    redis = await create_pool(RedisSettings.from_dsn(settings.redis_dsn))
    try:
        await redis.enqueue_job(
            "analyze_pcap_capture",
            engagement_id,
            pcap_id,
            actor_id,
            analysis_id,
        )
    finally:
        await redis.close()
