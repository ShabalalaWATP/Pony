# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for PCAP analysis API routes."""

from __future__ import annotations

import pytest
from conftest import BackendClient
from helpers import create_verified_admin
from httpx import Response

from cheeky_pony_backend.domain.pcap_models import PcapStatus
from cheeky_pony_shared import Engagement

pytestmark = pytest.mark.asyncio

PCAP_BYTES = b"\xd4\xc3\xb2\xa1" + b"\x02\x00\x04\x00" + b"\x00" * 16


async def test_pcap_analysis_lifecycle_returns_status_and_findings(
    backend_client: BackendClient,
) -> None:
    """Admin can queue analysis and operators can read structured findings."""

    csrf = await create_verified_admin(backend_client)
    await backend_client.store.create_engagement(Engagement(id="eng-1", name="Live"))
    created = await _upload(backend_client, "eng-1", csrf)
    pcap_id = str(created.json()["id"])

    accepted = await backend_client.client.post(
        f"/api/v1/engagements/eng-1/pcaps/{pcap_id}/analyze",
        headers={"x-csrf-token": csrf},
    )
    status_response = await backend_client.client.get(
        f"/api/v1/engagements/eng-1/pcaps/{pcap_id}/analysis"
    )
    findings = await backend_client.client.get(
        f"/api/v1/engagements/eng-1/pcaps/{pcap_id}/findings"
    )
    first_finding_id = findings.json()["items"][0]["id"]
    detail = await backend_client.client.get(
        f"/api/v1/engagements/eng-1/pcaps/{pcap_id}/findings/{first_finding_id}"
    )

    assert accepted.status_code == 202
    assert accepted.json()["analysis_id"]
    assert status_response.json()["analysis"]["status"] == "completed"
    assert status_response.json()["finding_counts"]["protocol_hierarchy"] == 1
    assert findings.json()["total"] == 3
    assert detail.json()["id"] == first_finding_id
    assert backend_client.store.audit_logs[-1].action == "pcap.finding.read"


async def test_pcap_analyze_rejects_concurrent_run(backend_client: BackendClient) -> None:
    """A second analyze request for an analyzing PCAP returns 409 and audits."""

    csrf = await create_verified_admin(backend_client)
    await backend_client.store.create_engagement(Engagement(id="eng-1", name="Live"))
    created = await _upload(backend_client, "eng-1", csrf)
    pcap_id = str(created.json()["id"])
    assert backend_client.pcap_store is not None
    claim = await backend_client.pcap_store.begin_analysis("eng-1", pcap_id)

    denied = await backend_client.client.post(
        f"/api/v1/engagements/eng-1/pcaps/{pcap_id}/analyze",
        headers={"x-csrf-token": csrf},
    )

    assert claim.status == "claimed"
    assert denied.status_code == 409
    assert denied.json()["detail"] == "analysis_in_progress"
    assert backend_client.store.audit_logs[-1].action == "pcap.analyze.start.refused"
    assert backend_client.store.audit_logs[-1].outcome == "denied:analysis_in_progress"


async def test_pcap_analyze_missing_csrf_is_audited(backend_client: BackendClient) -> None:
    """CSRF middleware refusals for analyze are PCAP-audited."""

    csrf = await create_verified_admin(backend_client)
    await backend_client.store.create_engagement(Engagement(id="eng-1", name="Live"))
    created = await _upload(backend_client, "eng-1", csrf)
    pcap_id = str(created.json()["id"])

    denied = await backend_client.client.post(f"/api/v1/engagements/eng-1/pcaps/{pcap_id}/analyze")

    assert denied.status_code == 403
    assert backend_client.store.audit_logs[-1].action == "pcap.analyze.start.refused"
    assert backend_client.store.audit_logs[-1].outcome == "denied:invalid_csrf"


async def test_analysis_read_cross_engagement_is_404(backend_client: BackendClient) -> None:
    """Analysis reads keep the same 404 cross-engagement behavior as metadata."""

    csrf = await create_verified_admin(backend_client)
    await backend_client.store.create_engagement(Engagement(id="eng-x", name="X"))
    await backend_client.store.create_engagement(Engagement(id="eng-y", name="Y"))
    created = await _upload(backend_client, "eng-x", csrf)
    pcap_id = str(created.json()["id"])

    response = await backend_client.client.get(
        f"/api/v1/engagements/eng-y/pcaps/{pcap_id}/analysis"
    )

    assert response.status_code == 404
    assert backend_client.store.audit_logs[-1].action == "pcap.analysis.read.refused"


async def _upload(bundle: BackendClient, engagement_id: str, csrf: str) -> Response:
    response = await bundle.client.post(
        f"/api/v1/engagements/{engagement_id}/pcaps",
        headers={"x-csrf-token": csrf},
        files={"file": ("capture.pcap", PCAP_BYTES, "application/vnd.tcpdump.pcap")},
    )
    assert response.status_code == 201
    assert response.json()["status"] == PcapStatus.UPLOADED
    return response
