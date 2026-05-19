# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for engagement report request, status, and download APIs."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from conftest import BackendClient
from helpers import create_verified_admin

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.reports import ReportFormat, ReportRecord, ReportStatus
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.security import TokenService
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


async def test_reports_require_admin_2fa(
    backend_client: BackendClient,
) -> None:
    """Operators cannot mint report exports that include privileged audit data."""

    await backend_client.store.create_user(
        UserRecord(
            id="operator-1",
            email="operator@example.com",
            password_hash="hash",
            roles=["operator"],
        )
    )
    await backend_client.store.create_engagement(Engagement(id="eng-1", name="Lab"))
    await backend_client.store.create_report(
        ReportRecord(
            id="report-1",
            engagement_id="eng-1",
            requested_by="admin-1",
            format=ReportFormat.JSONL,
            since=datetime(2026, 1, 1, tzinfo=UTC),
            until=datetime(2026, 1, 3, tzinfo=UTC),
            status=ReportStatus.READY,
            content_b64="Cg==",
            content_type="application/x-ndjson",
            filename="engagement-eng-1-report-report-1.jsonl",
        )
    )
    token = TokenService(_test_settings()).create_access_token("operator-1", "csrf")
    backend_client.client.cookies.set("access_token", token)

    created = await backend_client.client.post(
        "/api/v1/engagements/eng-1/reports",
        headers={"x-csrf-token": "csrf"},
        json={
            "format": "jsonl",
            "since": "2026-01-01T00:00:00Z",
            "until": "2026-01-03T00:00:00Z",
        },
    )
    status = await backend_client.client.get("/api/v1/engagements/eng-1/reports/report-1")
    downloaded = await backend_client.client.get(
        "/api/v1/engagements/eng-1/reports/report-1/download?token=invalid"
    )

    assert created.status_code == 403
    assert status.status_code == 403
    assert downloaded.status_code == 403
    assert backend_client.store.audit_logs[-1].action == "reports.create"
    assert backend_client.store.audit_logs[-1].outcome == "denied:admin_2fa_required"


async def _finish_report_if_needed(bundle: BackendClient, report_id: str) -> None:
    report = await bundle.store.get_report_by_id(report_id)
    if report is not None and report.status == ReportStatus.READY:
        return
    await generate_report({"store": bundle.store}, report_id)


def _test_settings() -> Settings:
    return Settings(
        env="test",
        cookie_secure=False,
        jwt_secret="j" * 32,
        bootstrap_token="bootstrap-" + "token-test",
        use_in_memory_store=True,
    )
