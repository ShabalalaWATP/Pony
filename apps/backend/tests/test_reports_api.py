# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for engagement report request, status, and download APIs."""

from __future__ import annotations

import base64
from datetime import UTC, datetime

import pytest
from conftest import BackendClient
from helpers import create_verified_admin

from cheeky_pony_backend.domain.pcap_models import Pcap, PcapStatus
from cheeky_pony_backend.domain.reports import ReportFormat, ReportRecord, ReportStatus
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.pcap.findings import (
    DeauthBurst,
    DeauthBurstsEvidence,
    DeauthBurstsFinding,
    FindingSeverity,
)
from cheeky_pony_backend.security import PasswordService
from cheeky_pony_backend.workers.tasks import generate_report
from cheeky_pony_shared import Engagement, Event, EventKind

pytestmark = pytest.mark.asyncio


async def test_report_lifecycle_returns_signed_download(backend_client: BackendClient) -> None:
    """An authenticated user can request, poll, and download a report."""

    csrf = await create_verified_admin(backend_client)
    await backend_client.store.create_engagement(Engagement(id="eng-1", name="Lab"))
    await backend_client.store.insert_event(
        Event(
            id="evt-1",
            sensor_id="pi-1",
            kind=EventKind.ACCESS_POINT_SEEN,
            payload={"bssid": "AA:BB:CC:DD:EE:FF"},
            occurred_at=datetime(2026, 1, 2, tzinfo=UTC),
        )
    )

    created = await backend_client.client.post(
        "/api/v1/engagements/eng-1/reports",
        headers={"x-csrf-token": csrf},
        json={
            "format": "jsonl",
            "since": "2026-01-01T00:00:00Z",
            "until": "2026-01-03T00:00:00Z",
        },
    )
    report_id = created.json()["report_id"]
    await _finish_report_if_needed(backend_client, report_id)
    status = await backend_client.client.get(f"/api/v1/engagements/eng-1/reports/{report_id}")
    downloaded = await backend_client.client.get(status.json()["download_url"])
    tampered = await backend_client.client.get(status.json()["download_url"] + "x")

    assert created.status_code == 202
    assert created.json()["status"] == "pending"
    assert status.status_code == 200
    assert status.json()["status"] == "ready"
    assert "/download?token=" in status.json()["download_url"]
    assert downloaded.status_code == 200
    assert downloaded.headers["content-type"] == "application/x-ndjson"
    assert b'"kind":"summary"' in downloaded.content
    assert tampered.status_code == 403
    assert backend_client.store.audit_logs[-1].action == "reports.create"


async def test_report_request_validates_engagement_and_range(
    backend_client: BackendClient,
) -> None:
    """Report creation rejects missing engagements and invalid ranges."""

    csrf = await create_verified_admin(backend_client)

    missing = await backend_client.client.post(
        "/api/v1/engagements/missing/reports",
        headers={"x-csrf-token": csrf},
        json={
            "format": "html",
            "since": "2026-01-03T00:00:00Z",
            "until": "2026-01-04T00:00:00Z",
        },
    )
    invalid_range = await backend_client.client.post(
        "/api/v1/engagements/missing/reports",
        headers={"x-csrf-token": csrf},
        json={
            "format": "pdf",
            "since": "2026-01-04T00:00:00Z",
            "until": "2026-01-03T00:00:00Z",
        },
    )

    assert missing.status_code == 404
    assert invalid_range.status_code == 422
    assert backend_client.store.audit_logs[-1].action == "reports.create"
    assert backend_client.store.audit_logs[-1].outcome == "denied:engagement_not_found"


async def test_report_creation_requires_admin_recent_totp(
    backend_client: BackendClient,
) -> None:
    """Operators cannot use reports to bypass admin-only audit access."""

    await create_verified_admin(backend_client)
    await backend_client.store.create_engagement(Engagement(id="eng-1", name="Lab"))
    await backend_client.store.create_user(
        UserRecord(
            id="operator-1",
            email="operator@example.com",
            password_hash=PasswordService().hash_password("long-password-123"),
            roles=["operator"],
        )
    )
    login = await backend_client.client.post(
        "/api/v1/auth/login",
        json={"email": "operator@example.com", "password": "long-password-123"},
    )

    denied = await backend_client.client.post(
        "/api/v1/engagements/eng-1/reports",
        headers={"x-csrf-token": str(login.json()["csrf_token"])},
        json={
            "format": "jsonl",
            "since": "2026-01-01T00:00:00Z",
            "until": "2026-01-03T00:00:00Z",
        },
    )

    assert denied.status_code == 403
    assert denied.json()["detail"] == "admin_required"
    assert backend_client.store.audit_logs[-1].action == "reports.create"
    assert backend_client.store.audit_logs[-1].outcome == "denied:admin_required"


async def test_report_generation_includes_capture_findings(
    backend_client: BackendClient,
) -> None:
    """Completed PCAP findings are summarized in generated reports."""

    report = await _create_report_record(backend_client, "report-pcap")
    await _create_report_pcap(backend_client, status=PcapStatus.ANALYZED)
    assert backend_client.pcap_analysis_store is not None
    await backend_client.pcap_analysis_store.create_findings([_deauth_finding()])

    generated = await generate_report(
        {
            "store": backend_client.store,
            "pcap_store": backend_client.pcap_store,
            "pcap_analysis_store": backend_client.pcap_analysis_store,
        },
        report.id,
    )
    loaded = await backend_client.store.get_report_by_id(report.id)

    assert generated is True
    assert loaded is not None
    assert loaded.content_b64 is not None
    content = base64.b64decode(loaded.content_b64.encode()).decode()
    assert "Capture findings" in content
    assert "Deauthentication bursts detected: 1" in content
    assert "PCAPs: 1" in content


async def test_report_generation_handles_pending_capture_analysis(
    backend_client: BackendClient,
) -> None:
    """Reports render cleanly when captures have no successful findings yet."""

    report = await _create_report_record(backend_client, "report-pending")
    await _create_report_pcap(backend_client, status=PcapStatus.UPLOADED)

    await generate_report(
        {
            "store": backend_client.store,
            "pcap_store": backend_client.pcap_store,
            "pcap_analysis_store": backend_client.pcap_analysis_store,
        },
        report.id,
    )
    loaded = await backend_client.store.get_report_by_id(report.id)

    assert loaded is not None
    assert loaded.content_b64 is not None
    content = base64.b64decode(loaded.content_b64.encode()).decode()
    assert "Capture findings" in content
    assert "Analysis pending or unavailable." in content


async def _finish_report_if_needed(bundle: BackendClient, report_id: str) -> None:
    report = await bundle.store.get_report_by_id(report_id)
    if report is not None and report.status == ReportStatus.READY:
        return
    await generate_report(
        {
            "store": bundle.store,
            "pcap_store": bundle.pcap_store,
            "pcap_analysis_store": bundle.pcap_analysis_store,
        },
        report_id,
    )


async def _create_report_record(bundle: BackendClient, report_id: str) -> ReportRecord:
    engagement = Engagement(id="eng-pcap", name="Capture Lab")
    await bundle.store.create_engagement(engagement)
    report = ReportRecord(
        id=report_id,
        engagement_id=engagement.id,
        requested_by="admin",
        format=ReportFormat.HTML,
        since=datetime(2026, 1, 1, tzinfo=UTC),
        until=datetime(2026, 1, 3, tzinfo=UTC),
    )
    return await bundle.store.create_report(report)


async def _create_report_pcap(bundle: BackendClient, status: PcapStatus) -> None:
    assert bundle.pcap_store is not None
    await bundle.pcap_store.create_pcap(
        Pcap(
            id="pcap-report",
            engagement_id="eng-pcap",
            filename_sanitized="demo-deauth-incident.pcapng",
            size_bytes=48,
            sha256="1" * 64,
            magic="pcapng",
            uploaded_by="admin",
            uploaded_at=datetime(2026, 1, 2, tzinfo=UTC),
            status=status,
            gridfs_id="gridfs-report",
        )
    )


def _deauth_finding() -> DeauthBurstsFinding:
    return DeauthBurstsFinding(
        id="finding-deauth",
        pcap_id="pcap-report",
        engagement_id="eng-pcap",
        analysis_id="analysis-report",
        severity=FindingSeverity.MEDIUM,
        summary="Deauthentication bursts detected: 1",
        evidence=DeauthBurstsEvidence(
            bursts=[
                DeauthBurst(
                    bssid="aa:bb:cc:dd:ee:ff",
                    count=10,
                    first_seen_epoch=1000.0,
                    last_seen_epoch=1010.0,
                )
            ]
        ),
        generated_at=datetime(2026, 1, 2, tzinfo=UTC),
    )
