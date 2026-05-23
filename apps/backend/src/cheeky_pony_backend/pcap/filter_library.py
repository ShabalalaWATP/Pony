# SPDX-License-Identifier: AGPL-3.0-only
"""Curated tshark filter registry and finding builders."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.oui_lookup import OuiService
from cheeky_pony_backend.domain.pcap_models import Pcap
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.pcap.filters import (
    beacons,
    conversations,
    deauth,
    dhcp,
    dns,
    eapol,
    probe_responses,
    protocol_hierarchy,
    tls_sni,
)
from cheeky_pony_backend.pcap.findings import (
    AnalysisRunStatus,
    BeaconsFinding,
    ConversationsFinding,
    DeauthBurstsFinding,
    DhcpHostnamesFinding,
    DnsSummaryFinding,
    EapolHandshakesFinding,
    FailedFinding,
    FailedFindingEvidence,
    Finding,
    FindingKind,
    FindingSeverity,
    ProbeResponseAnomaliesFinding,
    ProtocolHierarchyFinding,
    TlsSniSummaryFinding,
)
from cheeky_pony_shared import AccessPoint, Client

FindingFactory = Callable[["FilterParseContext", str], Finding]


@dataclass(frozen=True)
class FilterSpec:
    """One curated tshark filter and parser."""

    name: str
    args: Sequence[str]
    parse: FindingFactory


@dataclass(frozen=True)
class FilterParseContext:
    """Context available to finding builders after tshark output is parsed."""

    access_points: list[AccessPoint]
    analysis_id: str
    clients: list[Client]
    internal_hostname_suffixes: list[str]
    lab_mode: bool
    oui: OuiService
    pcap: Pcap


async def build_parse_context(
    store: Store | None,
    settings: Settings,
    oui: OuiService,
    pcap: Pcap,
    analysis_id: str,
) -> FilterParseContext:
    """Fetch bounded enrichment inputs for PCAP finding builders."""

    access_points, clients = await _fetch_records(store)
    return FilterParseContext(
        access_points=access_points,
        analysis_id=analysis_id,
        clients=clients,
        internal_hostname_suffixes=settings.pcap_internal_hostname_suffixes,
        lab_mode=settings.lab_mode,
        oui=oui,
        pcap=pcap,
    )


def filters(lab_mode: bool) -> list[FilterSpec]:
    """Return the code-reviewed tshark filters enabled for one run."""

    return [
        FilterSpec("protocol_hierarchy", protocol_hierarchy.build_args(), _protocol_finding),
        FilterSpec("conversations", conversations.build_args(), _conversation_finding),
        FilterSpec("deauth_bursts", deauth.build_args(), _deauth_finding),
        FilterSpec(
            "eapol_handshakes", eapol.build_args(include_lab_evidence=lab_mode), _eapol_finding
        ),
        FilterSpec("beacons", beacons.build_args(), _beacons_finding),
        FilterSpec(
            "probe_response_anomalies",
            probe_responses.build_args(),
            _probe_response_finding,
        ),
        FilterSpec("dns_summary", dns.build_args(), _dns_finding),
        FilterSpec("tls_sni_summary", tls_sni.build_args(), _tls_sni_finding),
        FilterSpec("dhcp_hostnames", dhcp.build_args(), _dhcp_finding),
    ]


def failed_finding(name: str, pcap: Pcap, analysis_id: str, reason: str) -> Finding:
    """Build a sanitized failed-filter placeholder finding."""

    return FailedFinding(
        id=str(uuid4()),
        pcap_id=pcap.id,
        engagement_id=pcap.engagement_id,
        analysis_id=analysis_id,
        severity=FindingSeverity.LOW,
        summary=f"{name[:120]} filter failed",
        evidence=FailedFindingEvidence(filter_name=name, reason=reason[:200] or "filter_failed"),
        generated_at=datetime.now(tz=UTC),
    )


def finding_counts(findings: list[Finding]) -> dict[FindingKind, int]:
    """Count findings by kind."""

    counts: dict[FindingKind, int] = {}
    for finding in findings:
        counts[finding.kind] = counts.get(finding.kind, 0) + 1
    return counts


def run_status(findings: list[Finding]) -> AnalysisRunStatus:
    """Summarize filter outcomes into an analysis run status."""

    failures = sum(1 for finding in findings if finding.kind == FindingKind.FILTER_FAILED)
    if failures == 0:
        return AnalysisRunStatus.COMPLETED
    if failures == len(findings):
        return AnalysisRunStatus.FAILED
    return AnalysisRunStatus.PARTIAL


async def _fetch_records(store: Store | None) -> tuple[list[AccessPoint], list[Client]]:
    if store is None:
        return [], []
    access_points, _ = await store.list_access_points(500, 0)
    clients, _ = await store.list_clients(500, 0)
    return access_points, clients


def _protocol_finding(context: FilterParseContext, output: str) -> Finding:
    evidence = protocol_hierarchy.parse(output)
    return ProtocolHierarchyFinding(
        id=str(uuid4()),
        pcap_id=context.pcap.id,
        engagement_id=context.pcap.engagement_id,
        analysis_id=context.analysis_id,
        severity=FindingSeverity.INFO,
        summary=f"Protocol hierarchy contains {len(evidence.protocols)} protocols",
        evidence=evidence,
        generated_at=datetime.now(tz=UTC),
    )


def _conversation_finding(context: FilterParseContext, output: str) -> Finding:
    evidence = conversations.parse(output)
    return ConversationsFinding(
        id=str(uuid4()),
        pcap_id=context.pcap.id,
        engagement_id=context.pcap.engagement_id,
        analysis_id=context.analysis_id,
        severity=FindingSeverity.INFO,
        summary=f"Top conversations extracted: {len(evidence.conversations)}",
        evidence=evidence,
        generated_at=datetime.now(tz=UTC),
    )


def _deauth_finding(context: FilterParseContext, output: str) -> Finding:
    evidence = deauth.parse(output)
    severity = FindingSeverity.MEDIUM if evidence.bursts else FindingSeverity.INFO
    return DeauthBurstsFinding(
        id=str(uuid4()),
        pcap_id=context.pcap.id,
        engagement_id=context.pcap.engagement_id,
        analysis_id=context.analysis_id,
        severity=severity,
        summary=f"Deauthentication bursts detected: {len(evidence.bursts)}",
        evidence=evidence,
        generated_at=datetime.now(tz=UTC),
    )


def _eapol_finding(context: FilterParseContext, output: str) -> Finding:
    evidence = eapol.parse(output)
    return EapolHandshakesFinding(
        id=str(uuid4()),
        pcap_id=context.pcap.id,
        engagement_id=context.pcap.engagement_id,
        analysis_id=context.analysis_id,
        severity=FindingSeverity.LOW,
        summary=f"EAPOL handshakes observed: {len(evidence.handshakes)}",
        evidence=evidence,
        generated_at=datetime.now(tz=UTC),
    )


def _beacons_finding(context: FilterParseContext, output: str) -> Finding:
    evidence = beacons.parse(output, context.access_points)
    mismatch_count = sum(len(network.mismatches) for network in evidence.networks)
    severity = FindingSeverity.MEDIUM if mismatch_count else FindingSeverity.INFO
    return BeaconsFinding(
        id=str(uuid4()),
        pcap_id=context.pcap.id,
        engagement_id=context.pcap.engagement_id,
        analysis_id=context.analysis_id,
        severity=severity,
        summary=f"Beacon networks observed: {len(evidence.networks)}",
        evidence=evidence,
        generated_at=datetime.now(tz=UTC),
    )


def _probe_response_finding(context: FilterParseContext, output: str) -> Finding:
    evidence = probe_responses.parse(output)
    severity = FindingSeverity.HIGH if evidence.anomalies else FindingSeverity.INFO
    return ProbeResponseAnomaliesFinding(
        id=str(uuid4()),
        pcap_id=context.pcap.id,
        engagement_id=context.pcap.engagement_id,
        analysis_id=context.analysis_id,
        severity=severity,
        summary=f"Probe-response anomalies detected: {len(evidence.anomalies)}",
        evidence=evidence,
        generated_at=datetime.now(tz=UTC),
    )


def _dns_finding(context: FilterParseContext, output: str) -> Finding:
    evidence = dns.parse(output, context.internal_hostname_suffixes)
    return DnsSummaryFinding(
        id=str(uuid4()),
        pcap_id=context.pcap.id,
        engagement_id=context.pcap.engagement_id,
        analysis_id=context.analysis_id,
        severity=FindingSeverity.INFO,
        summary=f"DNS queries summarized: {evidence.total_queries}",
        evidence=evidence,
        generated_at=datetime.now(tz=UTC),
    )


def _tls_sni_finding(context: FilterParseContext, output: str) -> Finding:
    evidence = tls_sni.parse(output, context.internal_hostname_suffixes)
    return TlsSniSummaryFinding(
        id=str(uuid4()),
        pcap_id=context.pcap.id,
        engagement_id=context.pcap.engagement_id,
        analysis_id=context.analysis_id,
        severity=FindingSeverity.INFO,
        summary=f"TLS SNI names summarized: {evidence.total_snis}",
        evidence=evidence,
        generated_at=datetime.now(tz=UTC),
    )


def _dhcp_finding(context: FilterParseContext, output: str) -> Finding:
    evidence = dhcp.parse(output, context.clients, context.oui)
    return DhcpHostnamesFinding(
        id=str(uuid4()),
        pcap_id=context.pcap.id,
        engagement_id=context.pcap.engagement_id,
        analysis_id=context.analysis_id,
        severity=FindingSeverity.INFO,
        summary=f"DHCP clients summarized: {len(evidence.clients)}",
        evidence=evidence,
        generated_at=datetime.now(tz=UTC),
    )
