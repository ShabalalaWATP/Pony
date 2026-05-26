# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for PCAP-finding LLM insights."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from conftest import BackendClient
from helpers import create_verified_admin

from cheeky_pony_backend.domain.pcap_models import Pcap, PcapStatus
from cheeky_pony_backend.llm.insights.pcap_finding import build_pcap_finding_context
from cheeky_pony_backend.pcap.findings import (
    EapolHandshake,
    EapolHandshakesEvidence,
    EapolHandshakesFinding,
    FindingSeverity,
)
from cheeky_pony_shared import Engagement

pytestmark = pytest.mark.asyncio


async def test_pcap_finding_context_drops_lab_gated_eapol_evidence(
    backend_client: BackendClient,
) -> None:
    """Prompt context never carries PMKID or raw EAPOL bytes."""

    await _seed_engagement(backend_client, "eng-1")
    await _seed_pcap(backend_client, "eng-1")
    await _seed_eapol_finding(backend_client, "finding-1", "eng-1")

    assert backend_client.pcap_analysis_store is not None
    assert backend_client.pcap_store is not None
    context = await build_pcap_finding_context(
        backend_client.store,
        backend_client.pcap_store,
        backend_client.pcap_analysis_store,
        "finding-1",
    )

    assert context is not None
    payload = context.model_dump_json()
    assert "00112233445566778899aabbccddeeff" not in payload
    assert "AQI=" not in payload
    assert "pmkid" not in payload
    assert "raw_bytes_b64" not in payload
    assert "eapol_observations" in payload


async def test_pcap_finding_route_generates_then_uses_cache(
    backend_client: BackendClient,
) -> None:
    """GET PCAP-finding insight generates once and serves cache hits."""

    await create_verified_admin(backend_client)
    backend_client.settings.llm_enabled = True
    await _seed_engagement(backend_client, "eng-1")
    await _seed_pcap(backend_client, "eng-1")
    await _seed_eapol_finding(backend_client, "finding-1", "eng-1")

    first = await backend_client.client.get("/api/v1/insights/pcap-finding/finding-1")
    second = await backend_client.client.get("/api/v1/insights/pcap-finding/finding-1")

    assert first.status_code == 200
    assert first.json()["kind"] == "pcap_finding"
    assert first.json()["cached"] is False
    assert second.status_code == 200
    assert second.json()["cached"] is True
    assert backend_client.llm_client is not None
    assert len(backend_client.llm_client.calls) == 1
    prompt = backend_client.llm_client.calls[0][0].content
    assert "AA:BB:CC:DD:EE:FF" not in prompt
    assert "11:22:33:44:55:66" not in prompt
    assert "AQI=" not in prompt
    assert "00112233445566778899aabbccddeeff" not in prompt
    assert backend_client.store.audit_logs[-2].action == "llm.insight.pcap_finding"
    assert backend_client.store.audit_logs[-1].parameters["outcome"] == "cached"


async def test_pcap_finding_route_returns_404_for_unknown_finding(
    backend_client: BackendClient,
) -> None:
    """Unknown findings are not generated and return 404."""

    await create_verified_admin(backend_client)
    backend_client.settings.llm_enabled = True

    response = await backend_client.client.get("/api/v1/insights/pcap-finding/missing")

    assert response.status_code == 404
    assert backend_client.store.audit_logs[-1].action == "llm.insight.pcap_finding"
    assert backend_client.store.audit_logs[-1].parameters["outcome"] == "refused"


async def test_pcap_finding_route_hides_orphaned_findings(
    backend_client: BackendClient,
) -> None:
    """Findings without a visible engagement are refused as 404."""

    await create_verified_admin(backend_client)
    backend_client.settings.llm_enabled = True
    await _seed_eapol_finding(backend_client, "finding-1", "eng-x")

    response = await backend_client.client.get("/api/v1/insights/pcap-finding/finding-1")

    assert response.status_code == 404
    assert backend_client.store.audit_logs[-1].parameters["outcome"] == "refused"


async def test_pcap_finding_route_hides_deleted_pcap_findings(
    backend_client: BackendClient,
) -> None:
    """Findings whose PCAP metadata is gone are refused as 404."""

    await create_verified_admin(backend_client)
    backend_client.settings.llm_enabled = True
    await _seed_engagement(backend_client, "eng-1")
    await _seed_pcap(backend_client, "eng-1")
    await _seed_eapol_finding(backend_client, "finding-1", "eng-1")
    assert backend_client.pcap_store is not None
    await backend_client.pcap_store.delete_pcap("eng-1", "pcap-1")

    response = await backend_client.client.get("/api/v1/insights/pcap-finding/finding-1")

    assert response.status_code == 404
    assert backend_client.store.audit_logs[-1].parameters["outcome"] == "refused"
    assert backend_client.llm_client is not None
    assert backend_client.llm_client.calls == []


async def _seed_engagement(bundle: BackendClient, engagement_id: str) -> None:
    await bundle.store.create_engagement(
        Engagement(
            id=engagement_id,
            name="Capture review",
            scope_rules=[{"kind": "bssid", "value": "AA:BB:CC:DD:EE:FF"}],
            started_at=datetime(2026, 5, 20, tzinfo=UTC),
        )
    )


async def _seed_pcap(bundle: BackendClient, engagement_id: str) -> None:
    assert bundle.pcap_store is not None
    await bundle.pcap_store.create_pcap(
        Pcap(
            id="pcap-1",
            engagement_id=engagement_id,
            filename_sanitized="capture.pcapng",
            size_bytes=128,
            sha256="a" * 64,
            magic="pcapng",
            uploaded_by="user-1",
            uploaded_at=datetime(2026, 5, 20, 11, 0, tzinfo=UTC),
            status=PcapStatus.ANALYZED,
            gridfs_id="gridfs-1",
        )
    )
    bundle.pcap_store.files["gridfs-1"] = b"\x0a\x0d\x0d\x0a"


async def _seed_eapol_finding(
    bundle: BackendClient,
    finding_id: str,
    engagement_id: str,
) -> None:
    assert bundle.pcap_analysis_store is not None
    await bundle.pcap_analysis_store.create_findings(
        [
            EapolHandshakesFinding(
                id=finding_id,
                pcap_id="pcap-1",
                engagement_id=engagement_id,
                analysis_id="analysis-1",
                severity=FindingSeverity.LOW,
                summary="EAPOL handshake metadata observed.",
                evidence=EapolHandshakesEvidence(
                    handshakes=[
                        EapolHandshake(
                            bssid="AA:BB:CC:DD:EE:FF",
                            client_mac="11:22:33:44:55:66",
                            complete=True,
                            message_count=4,
                            message_numbers=[1, 2, 3, 4],
                            pmkid="00112233445566778899aabbccddeeff",
                            raw_bytes_b64=["AQI="],
                        )
                    ]
                ),
                generated_at=datetime(2026, 5, 20, 12, 0, tzinfo=UTC),
            )
        ]
    )
