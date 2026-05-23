# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for report capture finding summaries."""

from __future__ import annotations

from datetime import UTC, datetime

from cheeky_pony_backend.domain.pcap_models import Pcap, PcapStatus
from cheeky_pony_backend.domain.report_capture_findings import (
    build_capture_findings_section,
    render_capture_findings_html,
    render_capture_findings_text,
)
from cheeky_pony_backend.pcap.findings import (
    DeauthBurst,
    DeauthBurstsEvidence,
    DeauthBurstsFinding,
    FindingSeverity,
)


def test_capture_findings_render_none_for_no_pcaps() -> None:
    """No PCAPs produce no report section."""

    assert build_capture_findings_section([], []) is None
    assert render_capture_findings_html(None) == ""
    assert render_capture_findings_text(None) == ""


def test_capture_findings_render_curated_text_and_html() -> None:
    """Curated PCAP findings are summarized without raw evidence."""

    section = build_capture_findings_section([_pcap(PcapStatus.ANALYZED)], [_finding()])
    assert section is not None

    html = render_capture_findings_html(section)
    text = render_capture_findings_text(section)

    assert section.total_pcaps == 1
    assert section.total_findings == 1
    assert "demo-deauth-incident.pcapng" in html
    assert "deauth_bursts" in text
    assert "aa:bb:cc:dd:ee:ff" not in html
    assert "aa:bb:cc:dd:ee:ff" not in text


def test_capture_findings_render_pending_text() -> None:
    """Pending captures produce a stable unavailable message."""

    section = build_capture_findings_section([_pcap(PcapStatus.UPLOADED)], [])
    assert section is not None

    text = render_capture_findings_text(section)

    assert section.unavailable_pcaps == 1
    assert "Analysis pending or unavailable." in text


def _pcap(status: PcapStatus) -> Pcap:
    return Pcap(
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


def _finding() -> DeauthBurstsFinding:
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
