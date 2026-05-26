# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for PCAP analysis persistence adapters."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Protocol, cast

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

from cheeky_pony_backend.infra.pcap_analysis_store import (
    InMemoryPcapAnalysisStore,
    MongoPcapAnalysisStore,
    PcapAnalysisStore,
)
from cheeky_pony_backend.pcap.findings import (
    JS_DATE_MAX_EPOCH_SECONDS,
    AnalysisRun,
    AnalysisRunStatus,
    DeauthBurst,
    DeauthBurstsEvidence,
    DeauthBurstsFinding,
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


async def test_mongo_analysis_store_ignores_invalid_legacy_findings() -> None:
    """Invalid historical finding documents are skipped instead of crashing reads."""

    valid = _finding("valid").model_dump(mode="json")
    invalid = _deauth_finding("invalid").model_dump(mode="json")
    evidence = cast(dict[str, object], invalid["evidence"])
    bursts = cast(list[dict[str, object]], evidence["bursts"])
    bursts[0]["first_seen_epoch"] = JS_DATE_MAX_EPOCH_SECONDS + 1.0
    db = _FakePcapDb([invalid, valid])
    store = MongoPcapAnalysisStore(db)  # type: ignore[arg-type]

    listed, total = await store.list_findings("eng-1", "pcap-1", 10, 0)
    loaded = await store.get_finding("eng-1", "pcap-1", "invalid")
    loaded_by_id = await store.get_finding_by_id("invalid")

    assert total == 1
    assert [item.id for item in listed] == ["valid"]
    assert loaded is None
    assert loaded_by_id is None


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
    loaded_by_id = await store.get_finding_by_id("finding-1")
    wrong_scope = await store.get_finding("eng-2", "pcap-1", "finding-1")
    counts = await store.finding_counts("eng-1", "pcap-1")

    assert latest == updated
    assert total == 1
    assert [item.id for item in listed] == [finding.id]
    assert loaded is not None
    assert loaded.id == finding.id
    assert loaded.evidence == finding.evidence
    assert loaded_by_id is not None
    assert loaded_by_id.id == finding.id
    assert wrong_scope is None
    assert counts == {FindingKind.PROTOCOL_HIERARCHY: 1}

    await store.delete_for_pcap("eng-1", "pcap-1")
    deleted_latest = await store.latest_run("eng-1", "pcap-1")
    deleted_findings, deleted_total = await store.list_findings("eng-1", "pcap-1", 10, 0)

    assert deleted_latest is None
    assert deleted_findings == []
    assert deleted_total == 0


async def _in_memory_store() -> PcapAnalysisStore:
    return InMemoryPcapAnalysisStore()


def _mongo_client(dsn: str) -> AsyncIOMotorClient[dict[str, object]]:
    return AsyncIOMotorClient[dict[str, object]](dsn)


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


def _deauth_finding(finding_id: str) -> DeauthBurstsFinding:
    return DeauthBurstsFinding(
        id=finding_id,
        pcap_id="pcap-1",
        engagement_id="eng-1",
        analysis_id="run-1",
        severity=FindingSeverity.MEDIUM,
        summary="Deauthentication burst observed",
        evidence=DeauthBurstsEvidence(
            bursts=[
                DeauthBurst(
                    bssid="aa:bb:cc:dd:ee:ff",
                    count=12,
                    first_seen_epoch=1.0,
                    last_seen_epoch=2.0,
                )
            ]
        ),
        generated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


class _FakePcapDb:
    def __init__(self, docs: list[dict[str, object]]) -> None:
        self.pcap_findings = _FakeFindingCollection(docs)


class _FakeFindingCollection:
    def __init__(self, docs: list[dict[str, object]]) -> None:
        self.docs = docs

    def find(
        self,
        query: dict[str, object],
        projection: dict[str, bool],
    ) -> _FakeFindingCursor:
        del projection
        return _FakeFindingCursor([doc for doc in self.docs if _matches_query(doc, query)])

    async def find_one(
        self,
        query: dict[str, object],
        projection: dict[str, bool],
    ) -> dict[str, object] | None:
        del projection
        for doc in self.docs:
            if _matches_query(doc, query):
                return doc
        return None


class _FakeFindingCursor:
    def __init__(self, docs: list[dict[str, object]]) -> None:
        self.docs = docs
        self.index = 0

    def sort(self, key: str, direction: int) -> _FakeFindingCursor:
        self.docs.sort(key=lambda item: str(item.get(key, "")), reverse=direction < 0)
        return self

    def __aiter__(self) -> _FakeFindingCursor:
        return self

    async def __anext__(self) -> dict[str, object]:
        if self.index >= len(self.docs):
            raise StopAsyncIteration
        doc = self.docs[self.index]
        self.index += 1
        return doc


def _matches_query(doc: dict[str, object], query: dict[str, object]) -> bool:
    return all(doc.get(key) == value for key, value in query.items())
