# SPDX-License-Identifier: AGPL-3.0-only
"""Persistence for PCAP analysis runs and findings."""

from __future__ import annotations

from typing import Protocol

from motor.motor_asyncio import AsyncIOMotorDatabase

from cheeky_pony_backend.pcap.findings import AnalysisRun, Finding, FindingKind


class PcapAnalysisStore(Protocol):
    """Persistence boundary for analysis runs and structured findings."""

    async def ensure_indexes(self) -> None:
        """Create backing indexes."""

    async def create_run(self, run: AnalysisRun) -> AnalysisRun:
        """Persist an analysis run."""

    async def update_run(self, run: AnalysisRun) -> AnalysisRun:
        """Persist updated analysis run state."""

    async def latest_run(self, engagement_id: str, pcap_id: str) -> AnalysisRun | None:
        """Return the newest analysis run for one PCAP."""

    async def create_findings(self, findings: list[Finding]) -> None:
        """Persist structured findings."""

    async def list_findings(
        self,
        engagement_id: str,
        pcap_id: str,
        limit: int,
        offset: int,
    ) -> tuple[list[Finding], int]:
        """List findings for one engagement-scoped PCAP."""

    async def get_finding(
        self,
        engagement_id: str,
        pcap_id: str,
        finding_id: str,
    ) -> Finding | None:
        """Return one engagement-scoped finding."""

    async def finding_counts(self, engagement_id: str, pcap_id: str) -> dict[FindingKind, int]:
        """Return finding counts by kind for one PCAP."""

    async def delete_for_pcap(self, engagement_id: str, pcap_id: str) -> None:
        """Delete analysis runs and findings for one PCAP."""


class InMemoryPcapAnalysisStore:
    """In-memory analysis store for tests."""

    def __init__(self) -> None:
        self.runs: dict[str, AnalysisRun] = {}
        self.findings: dict[str, Finding] = {}

    async def ensure_indexes(self) -> None:
        """No-op for in-memory storage."""

    async def create_run(self, run: AnalysisRun) -> AnalysisRun:
        """Persist an analysis run in memory."""

        self.runs[run.id] = run
        return run

    async def update_run(self, run: AnalysisRun) -> AnalysisRun:
        """Persist updated analysis run state in memory."""

        self.runs[run.id] = run
        return run

    async def latest_run(self, engagement_id: str, pcap_id: str) -> AnalysisRun | None:
        """Return the newest in-memory run."""

        runs = [
            run
            for run in self.runs.values()
            if run.engagement_id == engagement_id and run.pcap_id == pcap_id
        ]
        if not runs:
            return None
        return max(runs, key=lambda run: run.started_at)

    async def create_findings(self, findings: list[Finding]) -> None:
        """Persist findings in memory."""

        for finding in findings:
            self.findings[finding.id] = finding

    async def list_findings(
        self,
        engagement_id: str,
        pcap_id: str,
        limit: int,
        offset: int,
    ) -> tuple[list[Finding], int]:
        """List in-memory findings."""

        values = sorted(
            [
                finding
                for finding in self.findings.values()
                if finding.engagement_id == engagement_id and finding.pcap_id == pcap_id
            ],
            key=lambda finding: finding.generated_at,
            reverse=True,
        )
        return values[offset : offset + limit], len(values)

    async def get_finding(
        self,
        engagement_id: str,
        pcap_id: str,
        finding_id: str,
    ) -> Finding | None:
        """Return one in-memory finding."""

        finding = self.findings.get(finding_id)
        if finding is None:
            return None
        if finding.engagement_id != engagement_id or finding.pcap_id != pcap_id:
            return None
        return finding

    async def finding_counts(self, engagement_id: str, pcap_id: str) -> dict[FindingKind, int]:
        """Return in-memory finding counts by kind."""

        counts: dict[FindingKind, int] = {}
        for finding in self.findings.values():
            if finding.engagement_id != engagement_id or finding.pcap_id != pcap_id:
                continue
            counts[finding.kind] = counts.get(finding.kind, 0) + 1
        return counts

    async def delete_for_pcap(self, engagement_id: str, pcap_id: str) -> None:
        """Delete in-memory analysis data for one PCAP."""

        self.runs = {
            run_id: run
            for run_id, run in self.runs.items()
            if run.engagement_id != engagement_id or run.pcap_id != pcap_id
        }
        self.findings = {
            finding_id: finding
            for finding_id, finding in self.findings.items()
            if finding.engagement_id != engagement_id or finding.pcap_id != pcap_id
        }


class MongoPcapAnalysisStore:
    """Mongo-backed PCAP analysis store."""

    def __init__(self, db: AsyncIOMotorDatabase[dict[str, object]]) -> None:
        self._db = db

    async def ensure_indexes(self) -> None:
        """Create analysis indexes."""

        await self._db.pcap_analysis_runs.create_index([("engagement_id", 1), ("pcap_id", 1)])
        await self._db.pcap_findings.create_index([("engagement_id", 1), ("pcap_id", 1)])
        await self._db.pcap_findings.create_index(
            [("engagement_id", 1), ("pcap_id", 1), ("id", 1)],
            unique=True,
        )

    async def create_run(self, run: AnalysisRun) -> AnalysisRun:
        """Persist an analysis run."""

        await self._db.pcap_analysis_runs.insert_one(run.model_dump(mode="json"))
        return run

    async def update_run(self, run: AnalysisRun) -> AnalysisRun:
        """Persist updated analysis run state."""

        await self._db.pcap_analysis_runs.replace_one(
            {"id": run.id},
            run.model_dump(mode="json"),
            upsert=False,
        )
        return run

    async def latest_run(self, engagement_id: str, pcap_id: str) -> AnalysisRun | None:
        """Return the newest Mongo run."""

        data = await self._db.pcap_analysis_runs.find_one(
            {"engagement_id": engagement_id, "pcap_id": pcap_id},
            {"_id": False},
            sort=[("started_at", -1)],
        )
        return AnalysisRun.model_validate(data) if data else None

    async def create_findings(self, findings: list[Finding]) -> None:
        """Persist findings."""

        if not findings:
            return
        await self._db.pcap_findings.insert_many(
            [finding.model_dump(mode="json") for finding in findings]
        )

    async def list_findings(
        self,
        engagement_id: str,
        pcap_id: str,
        limit: int,
        offset: int,
    ) -> tuple[list[Finding], int]:
        """List findings for one PCAP."""

        query = {"engagement_id": engagement_id, "pcap_id": pcap_id}
        total = await self._db.pcap_findings.count_documents(query)
        docs = self._db.pcap_findings.find(query, {"_id": False}).sort("generated_at", -1)
        docs = docs.skip(offset).limit(limit)
        return [Finding.model_validate(doc) async for doc in docs], total

    async def get_finding(
        self,
        engagement_id: str,
        pcap_id: str,
        finding_id: str,
    ) -> Finding | None:
        """Return one finding by id."""

        data = await self._db.pcap_findings.find_one(
            {"engagement_id": engagement_id, "pcap_id": pcap_id, "id": finding_id},
            {"_id": False},
        )
        return Finding.model_validate(data) if data else None

    async def finding_counts(self, engagement_id: str, pcap_id: str) -> dict[FindingKind, int]:
        """Return finding counts by kind."""

        pipeline: list[dict[str, object]] = [
            {"$match": {"engagement_id": engagement_id, "pcap_id": pcap_id}},
            {"$group": {"_id": "$kind", "count": {"$sum": 1}}},
        ]
        counts: dict[FindingKind, int] = {}
        async for row in self._db.pcap_findings.aggregate(pipeline):
            counts[FindingKind(str(row["_id"]))] = int(row["count"])
        return counts

    async def delete_for_pcap(self, engagement_id: str, pcap_id: str) -> None:
        """Delete Mongo analysis data for one PCAP."""

        query = {"engagement_id": engagement_id, "pcap_id": pcap_id}
        await self._db.pcap_analysis_runs.delete_many(query)
        await self._db.pcap_findings.delete_many(query)
