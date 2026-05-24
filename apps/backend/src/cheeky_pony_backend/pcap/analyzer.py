# SPDX-License-Identifier: AGPL-3.0-only
"""PCAP analyzer orchestration."""

from __future__ import annotations

import asyncio
import os
import tempfile
from datetime import UTC, datetime

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.oui_lookup import OuiService, create_oui_service
from cheeky_pony_backend.domain.pcap_models import Pcap, PcapStatus
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.infra.pcap_analysis_store import PcapAnalysisStore
from cheeky_pony_backend.infra.pcap_store import PcapStore
from cheeky_pony_backend.pcap.filter_library import (
    FilterParseContext,
    FilterSpec,
    build_parse_context,
    failed_finding,
    filters,
    finding_counts,
    run_status,
)
from cheeky_pony_backend.pcap.findings import (
    AnalysisRun,
    AnalysisRunStatus,
    Finding,
)
from cheeky_pony_backend.pcap.tshark import TsharkError, TsharkRunner


class PcapAnalyzer:
    """Run curated tshark filters and persist structured findings."""

    def __init__(
        self,
        pcaps: PcapStore,
        analysis_store: PcapAnalysisStore,
        runtime: TsharkRunner,
        settings: Settings,
        store: Store | None = None,
        oui: OuiService | None = None,
    ) -> None:
        self._pcaps = pcaps
        self._analysis_store = analysis_store
        self._runtime = runtime
        self._settings = settings
        self._store = store
        self._oui = oui or create_oui_service()

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
        counts = finding_counts(findings)
        status = run_status(findings)
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
        context = await build_parse_context(
            self._store,
            self._settings,
            self._oui,
            pcap,
            analysis_id,
        )
        try:
            return [
                await self._run_filter(temp_path, context, spec)
                for spec in filters(self._settings.lab_mode)
            ]
        finally:
            os.unlink(temp_path)

    async def _run_filter(
        self,
        temp_path: str,
        context: FilterParseContext,
        spec: FilterSpec,
    ) -> Finding:
        fd = os.open(temp_path, os.O_RDONLY)
        try:
            result = await self._runtime.run_filter(
                pcap_fd=fd,
                filter_args=spec.args,
                timeout_seconds=self._settings.tshark_timeout_seconds,
            )
            return spec.parse(context, result.stdout)
        except OSError:
            return failed_finding(
                spec.name,
                context.pcap,
                context.analysis_id,
                "tshark_runtime_error",
            )
        except (TsharkError, ValueError) as exc:
            return failed_finding(
                spec.name,
                context.pcap,
                context.analysis_id,
                str(exc) or "filter_failed",
            )
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
