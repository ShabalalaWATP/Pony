# SPDX-License-Identifier: AGPL-3.0-only
"""PCAP analyzer orchestration."""

from __future__ import annotations

import asyncio
import os
import tempfile
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.pcap_models import Pcap, PcapStatus
from cheeky_pony_backend.infra.pcap_analysis_store import PcapAnalysisStore
from cheeky_pony_backend.infra.pcap_store import PcapStore
from cheeky_pony_backend.pcap.filters import conversations, deauth, protocol_hierarchy
from cheeky_pony_backend.pcap.findings import (
    AnalysisRun,
    AnalysisRunStatus,
    ConversationsFinding,
    DeauthBurstsFinding,
    FailedFinding,
    FailedFindingEvidence,
    Finding,
    FindingKind,
    FindingSeverity,
    ProtocolHierarchyFinding,
)
from cheeky_pony_backend.pcap.tshark import TsharkError, TsharkRunner

FindingFactory = Callable[[str, str, str, str], Finding]


@dataclass(frozen=True)
class FilterSpec:
    """One curated tshark filter and parser."""

    name: str
    args: Sequence[str]
    parse: Callable[[str, str, str, str], Finding]


class PcapAnalyzer:
    """Run curated tshark filters and persist structured findings."""

    def __init__(
        self,
        pcaps: PcapStore,
        analysis_store: PcapAnalysisStore,
        runtime: TsharkRunner,
        settings: Settings,
    ) -> None:
        self._pcaps = pcaps
        self._analysis_store = analysis_store
        self._runtime = runtime
        self._settings = settings

    async def analyze(self, pcap: Pcap, *, actor_id: str, analysis_id: str) -> AnalysisRun:
        """Analyze one uploaded capture."""

        started_at = datetime.now(tz=UTC)
        run = AnalysisRun(
            id=analysis_id,
            pcap_id=pcap.id,
            engagement_id=pcap.engagement_id,
            actor_id=actor_id,
            status=AnalysisRunStatus.RUNNING,
            started_at=started_at,
        )
        await self._analysis_store.create_run(run)
        findings = await self._run_filters(pcap, analysis_id)
        await self._analysis_store.create_findings(findings)
        counts = _finding_counts(findings)
        status = _run_status(findings)
        final_status = (
            PcapStatus.FAILED if status == AnalysisRunStatus.FAILED else PcapStatus.ANALYZED
        )
        await self._pcaps.update_pcap_status(pcap.engagement_id, pcap.id, final_status)
        updated = run.model_copy(
            update={
                "status": status,
                "finding_counts": counts,
                "finished_at": datetime.now(tz=UTC),
            }
        )
        return await self._analysis_store.update_run(updated)

    async def _run_filters(self, pcap: Pcap, analysis_id: str) -> list[Finding]:
        temp_path = await _materialize_pcap(self._pcaps, pcap.gridfs_id)
        try:
            return [
                await self._run_filter(temp_path, pcap, analysis_id, spec) for spec in _filters()
            ]
        finally:
            os.unlink(temp_path)

    async def _run_filter(
        self,
        temp_path: str,
        pcap: Pcap,
        analysis_id: str,
        spec: FilterSpec,
    ) -> Finding:
        fd = os.open(temp_path, os.O_RDONLY)
        try:
            result = await self._runtime.run_filter(
                pcap_fd=fd,
                filter_args=spec.args,
                timeout_seconds=self._settings.tshark_timeout_seconds,
            )
            return spec.parse(result.stdout, pcap.engagement_id, pcap.id, analysis_id)
        except (TsharkError, ValueError) as exc:
            return _failed_finding(spec.name, pcap, analysis_id, str(exc) or "filter_failed")
        finally:
            os.close(fd)


async def _materialize_pcap(pcaps: PcapStore, gridfs_id: str) -> str:
    handle = tempfile.NamedTemporaryFile(prefix="cheeky-pony-pcap-", suffix=".pcap", delete=False)
    try:
        async for chunk in pcaps.read_file(gridfs_id):
            await asyncio.to_thread(handle.write, chunk)
    finally:
        await asyncio.to_thread(handle.close)
    return handle.name


def _filters() -> list[FilterSpec]:
    return [
        FilterSpec("protocol_hierarchy", protocol_hierarchy.build_args(), _protocol_finding),
        FilterSpec("conversations", conversations.build_args(), _conversation_finding),
        FilterSpec("deauth_bursts", deauth.build_args(), _deauth_finding),
    ]


def _protocol_finding(output: str, engagement_id: str, pcap_id: str, analysis_id: str) -> Finding:
    evidence = protocol_hierarchy.parse(output)
    return ProtocolHierarchyFinding(
        id=str(uuid4()),
        pcap_id=pcap_id,
        engagement_id=engagement_id,
        analysis_id=analysis_id,
        severity=FindingSeverity.INFO,
        summary=f"Protocol hierarchy contains {len(evidence.protocols)} protocols",
        evidence=evidence,
        generated_at=datetime.now(tz=UTC),
    )


def _conversation_finding(
    output: str,
    engagement_id: str,
    pcap_id: str,
    analysis_id: str,
) -> Finding:
    evidence = conversations.parse(output)
    return ConversationsFinding(
        id=str(uuid4()),
        pcap_id=pcap_id,
        engagement_id=engagement_id,
        analysis_id=analysis_id,
        severity=FindingSeverity.INFO,
        summary=f"Top conversations extracted: {len(evidence.conversations)}",
        evidence=evidence,
        generated_at=datetime.now(tz=UTC),
    )


def _deauth_finding(output: str, engagement_id: str, pcap_id: str, analysis_id: str) -> Finding:
    evidence = deauth.parse(output)
    severity = FindingSeverity.MEDIUM if evidence.bursts else FindingSeverity.INFO
    return DeauthBurstsFinding(
        id=str(uuid4()),
        pcap_id=pcap_id,
        engagement_id=engagement_id,
        analysis_id=analysis_id,
        severity=severity,
        summary=f"Deauthentication bursts detected: {len(evidence.bursts)}",
        evidence=evidence,
        generated_at=datetime.now(tz=UTC),
    )


def _failed_finding(name: str, pcap: Pcap, analysis_id: str, reason: str) -> Finding:
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


def _finding_counts(findings: list[Finding]) -> dict[FindingKind, int]:
    counts: dict[FindingKind, int] = {}
    for finding in findings:
        counts[finding.kind] = counts.get(finding.kind, 0) + 1
    return counts


def _run_status(findings: list[Finding]) -> AnalysisRunStatus:
    failures = sum(1 for finding in findings if finding.kind == FindingKind.FILTER_FAILED)
    if failures == 0:
        return AnalysisRunStatus.COMPLETED
    if failures == len(findings):
        return AnalysisRunStatus.FAILED
    return AnalysisRunStatus.PARTIAL
