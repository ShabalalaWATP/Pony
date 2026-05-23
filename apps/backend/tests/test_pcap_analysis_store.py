# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for PCAP analysis persistence adapters."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Protocol

import pytest

from cheeky_pony_backend.infra.pcap_analysis_store import (
    InMemoryPcapAnalysisStore,
    MongoPcapAnalysisStore,
    PcapAnalysisStore,
)
from cheeky_pony_backend.pcap.findings import (
    AnalysisRun,
    AnalysisRunStatus,
    FindingKind,
    FindingSeverity,
    ProtocolHierarchyEvidence,
    ProtocolHierarchyFinding,
)

pytestmark = pytest.mark.asyncio


class StoreFactory(Protocol):
    async def __call__(self) -> PcapAnalysisStore: ...


async def test_in_memory_analysis_store_round_trips_runs_and_findings() -> None:
    """In-memory store follows the analysis persistence contract."""

    await _assert_analysis_store_contract(_in_memory_store)


async def test_mongo_analysis_store_round_trips_runs_and_findings() -> None:
    """Mongo store follows the same contract as the in-memory store."""

    mongodb = pytest.importorskip("testcontainers.mongodb")
    container = mongodb.MongoDbContainer("mongo:7.0")
    try:
        container.start()
    except Exception as exc:  # pragma: no cover - depends on local Docker availability
        pytest.skip(f"MongoDB testcontainer unavailable: {exc}")
    try:
        client = _mongo_client(container.get_connection_url())
        db = client.pcap_analysis_store_test

        async def factory() -> PcapAnalysisStore:
            return MongoPcapAnalysisStore(db)

        await _assert_analysis_store_contract(factory)
    finally:
        container.stop()


async def _assert_analysis_store_contract(factory: StoreFactory) -> None:
    store = await factory()
    await store.ensure_indexes()

    created = await store.create_run(_run("run-1", AnalysisRunStatus.RUNNING))
    updated = await store.update_run(
        created.model_copy(
            update={
                "status": AnalysisRunStatus.COMPLETED,
                "finding_counts": {FindingKind.PROTOCOL_HIERARCHY: 1},
                "finished_at": datetime(2026, 1, 1, 0, 1, tzinfo=UTC),
            }
        )
    )
    finding = _finding("finding-1")
    await store.create_findings([finding])

    latest = await store.latest_run("eng-1", "pcap-1")
    listed, total = await store.list_findings("eng-1", "pcap-1", 10, 0)
    loaded = await store.get_finding("eng-1", "pcap-1", "finding-1")
    wrong_scope = await store.get_finding("eng-2", "pcap-1", "finding-1")
    counts = await store.finding_counts("eng-1", "pcap-1")

    assert latest == updated
    assert total == 1
    assert [item.id for item in listed] == [finding.id]
    assert loaded is not None
    assert loaded.id == finding.id
    assert loaded.evidence == finding.evidence
    assert wrong_scope is None
    assert counts == {FindingKind.PROTOCOL_HIERARCHY: 1}


async def _in_memory_store() -> PcapAnalysisStore:
    return InMemoryPcapAnalysisStore()


def _mongo_client(dsn: str):
    from motor.motor_asyncio import AsyncIOMotorClient

    return AsyncIOMotorClient(dsn)


def _run(run_id: str, status: AnalysisRunStatus) -> AnalysisRun:
    return AnalysisRun(
        id=run_id,
        pcap_id="pcap-1",
        engagement_id="eng-1",
        actor_id="admin",
        status=status,
        started_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


def _finding(finding_id: str) -> ProtocolHierarchyFinding:
    return ProtocolHierarchyFinding(
        id=finding_id,
        pcap_id="pcap-1",
        engagement_id="eng-1",
        analysis_id="run-1",
        severity=FindingSeverity.INFO,
        summary="Protocol hierarchy contains 1 protocols",
        evidence=ProtocolHierarchyEvidence(protocols=[]),
        generated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
