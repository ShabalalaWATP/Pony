# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for engagement-summary LLM insights."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import cast

import pytest
from conftest import BackendClient
from fastapi import BackgroundTasks, WebSocket
from helpers import create_verified_admin

from cheeky_pony_backend.api.v1.engagement_end import request_lab_record_stops
from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.pcap_models import Pcap, PcapStatus
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.infra.operator_broker import OperatorBroker
from cheeky_pony_backend.infra.sensor_command_broker import LabCommandRecord, SensorCommandBroker
from cheeky_pony_backend.llm.dispatch import dispatch_engagement_summary
from cheeky_pony_backend.llm.insights.engagement_summary import (
    build_engagement_summary_context,
)
from cheeky_pony_backend.llm.prompts import PromptTemplates
from cheeky_pony_backend.llm.redactor import PromptRedactor
from cheeky_pony_backend.llm.runtime_flags import InMemoryLlmRuntimeFlags
from cheeky_pony_backend.llm.task_context import LlmTaskContext
from cheeky_pony_backend.pcap.findings import (
    FindingSeverity,
    ProtocolHierarchyEvidence,
    ProtocolHierarchyFinding,
)
from cheeky_pony_backend.workers.tasks import generate_engagement_summary_insight
from cheeky_pony_shared import Alert, AlertSeverity, Engagement, Event, EventKind

pytestmark = pytest.mark.asyncio


async def test_engagement_summary_context_is_deterministic(
    backend_client: BackendClient,
) -> None:
    """Builder returns stable aggregate context for fixture engagement data."""

    await _seed_engagement_inputs(backend_client)

    first = await build_engagement_summary_context(
        backend_client.store,
        "eng-1",
        pcap_store=backend_client.pcap_store,
        analysis_store=backend_client.pcap_analysis_store,
    )
    second = await build_engagement_summary_context(
        backend_client.store,
        "eng-1",
        pcap_store=backend_client.pcap_store,
        analysis_store=backend_client.pcap_analysis_store,
    )

    assert first is not None
    assert second is not None
    assert first.model_dump(mode="json") == second.model_dump(mode="json")
    assert {item.kind: item.count for item in first.event_counts} == {
        "access_point_seen": 1,
        "client_seen": 1,
    }
    assert {item.kind: item.count for item in first.pcap_finding_counts} == {
        "protocol_hierarchy": 1
    }


async def test_engagement_summary_route_generates_then_uses_cache(
    backend_client: BackendClient,
) -> None:
    """GET engagement insight generates once and serves cache hits."""

    await create_verified_admin(backend_client)
    backend_client.settings.llm_enabled = True
    await _seed_engagement_inputs(backend_client)

    first = await backend_client.client.get("/api/v1/insights/engagement/eng-1")
    second = await backend_client.client.get("/api/v1/insights/engagement/eng-1")

    assert first.status_code == 200
    assert first.json()["kind"] == "engagement_summary"
    assert first.json()["cached"] is False
    assert second.status_code == 200
    assert second.json()["cached"] is True
    assert backend_client.llm_client is not None
    assert len(backend_client.llm_client.calls) == 1
    assert [log.parameters["outcome"] for log in backend_client.store.audit_logs[-2:]] == [
        "generated",
        "cached",
    ]


async def test_engagement_summary_route_returns_404_for_unknown_engagement(
    backend_client: BackendClient,
) -> None:
    """Unknown engagements are not generated and return 404."""

    await create_verified_admin(backend_client)
    backend_client.settings.llm_enabled = True

    response = await backend_client.client.get("/api/v1/insights/engagement/missing")

    assert response.status_code == 404
    assert backend_client.store.audit_logs[-1].parameters["outcome"] == "refused"


async def test_engagement_end_generates_summary_once(
    backend_client: BackendClient,
) -> None:
    """Ending an engagement triggers one background summary generation."""

    csrf = await create_verified_admin(backend_client)
    backend_client.settings.llm_enabled = True
    await _seed_engagement_inputs(backend_client, ended=False)

    first = await backend_client.client.post(
        "/api/v1/engagements/eng-1/end",
        headers={"x-csrf-token": csrf},
    )
    second = await backend_client.client.post(
        "/api/v1/engagements/eng-1/end",
        headers={"x-csrf-token": csrf},
    )

    assert first.status_code == 204
    assert second.status_code == 204
    assert backend_client.llm_client is not None
    assert len(backend_client.llm_client.calls) == 1


async def test_worker_generates_engagement_summary(backend_client: BackendClient) -> None:
    """The arq task path generates engagement-summary insights."""

    backend_client.settings.llm_enabled = True
    await _seed_engagement_inputs(backend_client)

    generated = await generate_engagement_summary_insight(
        {
            "settings": backend_client.settings,
            "store": backend_client.store,
            "pcap_store": backend_client.pcap_store,
            "pcap_analysis_store": backend_client.pcap_analysis_store,
            "llm_client": backend_client.llm_client,
            "insight_cache": backend_client.insight_cache,
            "usage_ledger": backend_client.usage_ledger,
            "prompt_templates": PromptTemplates.load(),
            "prompt_redactor": PromptRedactor(),
            "runtime_flags": InMemoryLlmRuntimeFlags(),
        },
        "eng-1",
    )

    assert generated is True
    assert backend_client.store.audit_logs[-1].action == "llm.insight.engagement_summary"


async def test_dispatch_engagement_summary_queues_arq_job(
    backend_client: BackendClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Production dispatch uses the arq queue and closes Redis."""

    redis = FakeRedis()

    async def fake_create_pool(_: object) -> FakeRedis:
        return redis

    monkeypatch.setattr("cheeky_pony_backend.llm.dispatch.create_pool", fake_create_pool)
    settings = Settings(
        env="dev",
        cookie_secure=False,
        jwt_secret="j" * 32,
        bootstrap_token="bootstrap-token-test",
        use_in_memory_store=False,
        llm_enabled=True,
        llm_api_base_url="http://localhost:11434/v1",
    )

    await dispatch_engagement_summary(
        BackgroundTasks(),
        settings,
        _task_context(backend_client, settings),
        "eng-1",
    )

    assert redis.jobs == [("generate_engagement_summary_insight", "eng-1")]
    assert redis.closed is True


async def test_request_lab_record_stops_audits_and_broadcasts(
    backend_client: BackendClient,
) -> None:
    """Engagement-end helper requests stops without terminal stopped payloads."""

    broker = SensorCommandBroker()
    operator = OperatorBroker()
    websocket = FakeWebSocket()
    await operator.connect(cast(WebSocket, websocket), "user-1")
    started = datetime(2026, 5, 20, tzinfo=UTC)
    record = LabCommandRecord(
        command_id="cmd-1",
        module="deauth",
        sensor_id="sensor-1",
        engagement_id="eng-1",
        target={"kind": "bssid", "value": "AA:BB:CC:DD:EE:FF"},
        started_at=started,
        parameters={},
    )
    await broker.start_lab_command(record)

    await request_lab_record_stops(
        [record],
        _user(),
        "eng-1",
        started + timedelta(minutes=5),
        AuditLogger(backend_client.store),
        broker,
        operator,
    )

    assert backend_client.store.audit_logs[-1].action == "lab.deauth.stop"
    assert backend_client.store.audit_logs[-1].outcome == "stop_requested"
    assert websocket.sent[0]["kind"] == "lab.progress"
    assert websocket.sent[0]["command_id"] == "cmd-1"
    assert await broker.get_lab_command("cmd-1") is not None


async def _seed_engagement_inputs(
    backend_client: BackendClient,
    *,
    ended: bool = True,
) -> None:
    started = datetime(2026, 5, 20, tzinfo=UTC)
    ended_at = started + timedelta(hours=2) if ended else None
    await backend_client.store.create_engagement(
        Engagement(
            id="eng-1",
            name="Demo engagement",
            scope_rules=[{"kind": "bssid", "value": "AA:BB:CC:DD:EE:FF"}],
            started_at=started,
            ended_at=ended_at,
        )
    )
    await backend_client.store.insert_event(_event("evt-1", EventKind.ACCESS_POINT_SEEN, started))
    await backend_client.store.insert_event(_event("evt-2", EventKind.CLIENT_SEEN, started))
    await backend_client.store.insert_alert(
        Alert(
            id="alert-1",
            rule_id="rule-1",
            severity=AlertSeverity.HIGH,
            related_entities=["AA:BB:CC:DD:EE:FF"],
        )
    )
    await _seed_pcap_finding(backend_client, started)


def _event(event_id: str, kind: EventKind, started: datetime) -> Event:
    return Event(
        id=event_id,
        sensor_id="sensor-1",
        kind=kind,
        payload={"bssid": "AA:BB:CC:DD:EE:FF"},
        occurred_at=started + timedelta(minutes=5),
    )


def _task_context(bundle: BackendClient, settings: Settings) -> LlmTaskContext:
    assert bundle.pcap_store is not None
    assert bundle.pcap_analysis_store is not None
    assert bundle.llm_client is not None
    assert bundle.insight_cache is not None
    assert bundle.usage_ledger is not None
    return LlmTaskContext(
        settings=settings,
        store=bundle.store,
        pcap_store=bundle.pcap_store,
        pcap_analysis_store=bundle.pcap_analysis_store,
        client=bundle.llm_client,
        cache=bundle.insight_cache,
        ledger=bundle.usage_ledger,
        redactor=PromptRedactor(),
        templates=PromptTemplates.load(),
        runtime_flags=InMemoryLlmRuntimeFlags(),
    )


def _user() -> UserRecord:
    return UserRecord(
        id="user-1",
        email="admin@example.com",
        password_hash="hash",
        roles=["admin"],
    )


class FakeRedis:
    """Small async Redis queue fake for dispatch tests."""

    def __init__(self) -> None:
        self.jobs: list[tuple[str, str]] = []
        self.closed = False

    async def enqueue_job(self, name: str, engagement_id: str) -> None:
        self.jobs.append((name, engagement_id))

    async def close(self) -> None:
        self.closed = True


class FakeWebSocket:
    """Small WebSocket fake for operator broadcast tests."""

    def __init__(self) -> None:
        self.sent: list[dict[str, object]] = []

    async def send_json(self, payload: dict[str, object]) -> None:
        self.sent.append(payload)


async def _seed_pcap_finding(bundle: BackendClient, started: datetime) -> None:
    assert bundle.pcap_store is not None
    assert bundle.pcap_analysis_store is not None
    await bundle.pcap_store.create_pcap(
        Pcap(
            id="pcap-1",
            engagement_id="eng-1",
            filename_sanitized="capture.pcapng",
            size_bytes=128,
            sha256="a" * 64,
            magic="pcapng",
            uploaded_by="user-1",
            uploaded_at=started,
            status=PcapStatus.ANALYZED,
            gridfs_id="gridfs-1",
        )
    )
    await bundle.pcap_analysis_store.create_findings(
        [
            ProtocolHierarchyFinding(
                id="finding-1",
                pcap_id="pcap-1",
                engagement_id="eng-1",
                analysis_id="analysis-1",
                severity=FindingSeverity.INFO,
                summary="Protocol hierarchy parsed.",
                evidence=ProtocolHierarchyEvidence(protocols=[]),
                generated_at=started,
            )
        ]
    )
