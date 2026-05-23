# SPDX-License-Identifier: AGPL-3.0-only
"""Capture finding summaries for engagement reports."""

from __future__ import annotations

from html import escape

from pydantic import BaseModel, ConfigDict, Field

from cheeky_pony_backend.domain.pcap_models import Pcap, PcapStatus
from cheeky_pony_backend.pcap.findings import Finding, FindingKind, FindingSeverity

_CURATED_KINDS = {
    FindingKind.DEAUTH_BURSTS,
    FindingKind.PROBE_RESPONSE_ANOMALIES,
    FindingKind.DHCP_HOSTNAMES,
}
_MAX_CURATED_FINDINGS = 25


class CaptureFindingSummary(BaseModel):
    """Bounded report summary for one structured PCAP finding."""

    model_config = ConfigDict(extra="forbid")

    filename: str = Field(min_length=1, max_length=128)
    kind: FindingKind
    pcap_id: str = Field(min_length=1, max_length=128)
    severity: FindingSeverity
    summary: str = Field(min_length=1, max_length=200)


class CaptureFindingsSection(BaseModel):
    """Report section summarizing analyzed capture findings."""

    model_config = ConfigDict(extra="forbid")

    curated_findings: list[CaptureFindingSummary] = Field(default_factory=list)
    other_findings_count: int = Field(ge=0)
    total_findings: int = Field(ge=0)
    total_pcaps: int = Field(ge=0)
    unavailable_pcaps: int = Field(ge=0)


def build_capture_findings_section(
    pcaps: list[Pcap],
    findings: list[Finding],
) -> CaptureFindingsSection | None:
    """Build a non-raw PCAP finding section for an engagement report."""

    if not pcaps:
        return None
    by_id = {pcap.id: pcap for pcap in pcaps}
    curated = [
        _summary_for_finding(finding, by_id[finding.pcap_id])
        for finding in findings
        if finding.kind in _CURATED_KINDS and finding.pcap_id in by_id
    ][:_MAX_CURATED_FINDINGS]
    return CaptureFindingsSection(
        curated_findings=curated,
        other_findings_count=max(0, len(findings) - len(curated)),
        total_findings=len(findings),
        total_pcaps=len(pcaps),
        unavailable_pcaps=sum(1 for pcap in pcaps if pcap.status != PcapStatus.ANALYZED),
    )


def render_capture_findings_html(section: CaptureFindingsSection | None) -> str:
    """Render the capture findings report fragment as escaped HTML."""

    if section is None:
        return ""
    if not section.curated_findings:
        return _empty_capture_html(section)
    rows = "".join(_capture_row_html(finding) for finding in section.curated_findings)
    return (
        "<h2>Capture findings</h2>"
        f"<p>PCAPs: {section.total_pcaps}; findings: {section.total_findings}; "
        f"other findings: {section.other_findings_count}; "
        f"unavailable captures: {section.unavailable_pcaps}</p>"
        f"<ul>{rows}</ul>"
    )


def render_capture_findings_text(section: CaptureFindingsSection | None) -> str:
    """Render the capture findings report fragment as plain text."""

    if section is None:
        return ""
    lines = [
        "Capture findings",
        (
            f"PCAPs: {section.total_pcaps}; findings: {section.total_findings}; "
            f"other findings: {section.other_findings_count}; "
            f"unavailable captures: {section.unavailable_pcaps}"
        ),
    ]
    if not section.curated_findings:
        lines.append("Analysis pending or unavailable.")
        return "\n".join(lines) + "\n"
    lines.extend(
        f"- {finding.filename}: {finding.kind.value} [{finding.severity.value}] {finding.summary}"
        for finding in section.curated_findings
    )
    return "\n".join(lines) + "\n"


def _summary_for_finding(finding: Finding, pcap: Pcap) -> CaptureFindingSummary:
    return CaptureFindingSummary(
        filename=pcap.filename_sanitized,
        kind=finding.kind,
        pcap_id=pcap.id,
        severity=finding.severity,
        summary=finding.summary,
    )


def _capture_row_html(finding: CaptureFindingSummary) -> str:
    return (
        "<li>"
        f"{escape(finding.filename)}: {escape(finding.kind.value)} "
        f"[{escape(finding.severity.value)}] {escape(finding.summary)}"
        "</li>"
    )


def _empty_capture_html(section: CaptureFindingsSection) -> str:
    return (
        "<h2>Capture findings</h2>"
        f"<p>PCAPs: {section.total_pcaps}; findings: {section.total_findings}; "
        f"unavailable captures: {section.unavailable_pcaps}</p>"
        "<p>Analysis pending or unavailable.</p>"
    )
