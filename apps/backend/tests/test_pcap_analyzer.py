# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for PCAP analyzer orchestration."""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from datetime import UTC, datetime

import pytest

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.pcap_models import Pcap, PcapStatus
from cheeky_pony_backend.infra.pcap_analysis_store import InMemoryPcapAnalysisStore
from cheeky_pony_backend.infra.pcap_store import InMemoryPcapStore
from cheeky_pony_backend.pcap.analyzer import PcapAnalyzer
from cheeky_pony_backend.pcap.findings import AnalysisRunStatus, FailedFindingEvidence, FindingKind
from cheeky_pony_backend.pcap.tshark import TsharkError, TsharkResult

pytestmark = pytest.mark.asyncio

PCAP_BYTES = b"\xd4\xc3\xb2\xa1" + b"\x02\x00\x04\x00" + b"\x00" * 16


async def test_analyzer_persists_partial_run_when_one_filter_fails() -> None:
    """One filter failure creates a failed finding while other filters complete."""

    pcaps = InMemoryPcapStore()
    analysis_store = InMemoryPcapAnalysisStore()
    gridfs_id = await pcaps.write_file("capture.pcap", _chunks(), {"pcap_id": "pcap-1"})
    pcap = await pcaps.create_pcap(_pcap(gridfs_id))

    run = await PcapAnalyzer(
        pcaps,
        analysis_store,
        PartiallyFailingRuntime(),
        Settings(env="test", use_in_memory_store=True),
    ).analyze(pcap, actor_id="admin", analysis_id="analysis-1")

    findings, total = await analysis_store.list_findings("eng-1", "pcap-1", 10, 0)
    updated = await pcaps.get_pcap("eng-1", "pcap-1")

    assert run.status == AnalysisRunStatus.PARTIAL
    assert total == 9
    assert any(finding.kind == FindingKind.FILTER_FAILED for finding in findings)
    assert updated is not None
    assert updated.status == PcapStatus.ANALYZED


async def test_analyzer_records_failed_findings_when_runtime_missing() -> None:
    """Missing tshark becomes structured failed findings instead of an unhandled error."""

    pcaps = InMemoryPcapStore()
    analysis_store = InMemoryPcapAnalysisStore()
    gridfs_id = await pcaps.write_file("capture.pcap", _chunks(), {"pcap_id": "pcap-1"})
    pcap = await pcaps.create_pcap(_pcap(gridfs_id))

    run = await PcapAnalyzer(
        pcaps,
        analysis_store,
        MissingRuntime(),
        Settings(env="test", use_in_memory_store=True),
    ).analyze(pcap, actor_id="admin", analysis_id="analysis-1")

    findings, total = await analysis_store.list_findings("eng-1", "pcap-1", 20, 0)
    updated = await pcaps.get_pcap("eng-1", "pcap-1")

    assert run.status == AnalysisRunStatus.FAILED
    assert total == 9
    reasons: list[str] = []
    for finding in findings:
        assert finding.kind == FindingKind.FILTER_FAILED
        assert isinstance(finding.evidence, FailedFindingEvidence)
        reasons.append(finding.evidence.reason)
    assert set(reasons) == {"tshark_runtime_error"}
    assert updated is not None
    assert updated.status == PcapStatus.FAILED


class PartiallyFailingRuntime:
    """Runtime that fails the conversation filter only."""

    async def run_filter(
        self,
        *,
        pcap_fd: int,
        filter_args: Sequence[str],
        timeout_seconds: int,
    ) -> TsharkResult:
        del pcap_fd, timeout_seconds
        args = " ".join(filter_args)
        if "conv" in args:
            raise TsharkError("conversation parser failed")
        if "io,phs" in args:
            return TsharkResult(stdout="eth frames:1 bytes:100\n", stderr="")
        return TsharkResult(stdout="", stderr="")


class MissingRuntime:
    """Runtime that simulates tshark being absent from PATH."""

    async def run_filter(
        self,
        *,
        pcap_fd: int,
        filter_args: Sequence[str],
        timeout_seconds: int,
    ) -> TsharkResult:
        del pcap_fd, filter_args, timeout_seconds
        raise FileNotFoundError("tshark")


def _pcap(gridfs_id: str) -> Pcap:
    return Pcap(
        id="pcap-1",
        engagement_id="eng-1",
        filename_sanitized="capture.pcap",
        size_bytes=len(PCAP_BYTES),
        sha256="0" * 64,
        magic="pcap_le",
        uploaded_by="admin",
        uploaded_at=datetime(2026, 1, 1, tzinfo=UTC),
        status=PcapStatus.ANALYZING,
        gridfs_id=gridfs_id,
    )


async def _chunks() -> AsyncIterator[bytes]:
    yield PCAP_BYTES
