# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for worker task functions."""

from __future__ import annotations

import pytest

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.infra.in_memory_store import InMemoryStore
from cheeky_pony_backend.llm.budget import InMemoryUsageLedger
from cheeky_pony_backend.llm.cache import InMemoryInsightCache
from cheeky_pony_backend.llm.fake_client import FakeLlmClient
from cheeky_pony_backend.llm.prompts import PromptTemplates
from cheeky_pony_backend.llm.redactor import PromptRedactor
from cheeky_pony_backend.workers.tasks import (
    batch_insert_events,
    enrich_oui_vendor,
    evaluate_alerts,
)
from cheeky_pony_shared import AlertRule, AlertSeverity

pytestmark = pytest.mark.asyncio


async def test_worker_tasks_return_expected_placeholders() -> None:
    """Worker task placeholders are deterministic."""

    assert await batch_insert_events({}, [{"id": "evt-1"}]) == 1
    assert await enrich_oui_vendor({}, "AA:BB:CC:00:00:00") == "unknown"
    assert await enrich_oui_vendor({}, "") is None
    assert await evaluate_alerts({}, {"id": "evt-1"}) == []


async def test_alert_worker_evaluates_enabled_rules() -> None:
    """Alert worker evaluates enabled rules when a store is supplied."""

    store = InMemoryStore()
    await store.create_alert_rule(_free_ssid_rule())

    alerts = await evaluate_alerts(
        {"store": store},
        _free_ssid_event(),
    )

    assert alerts[0]["rule_id"] == "rule-1"
    assert alerts[0]["severity"] == "high"


async def test_batch_insert_events_persists_and_evaluates_alerts() -> None:
    """Batch event worker persists events and evaluates enabled alert rules."""

    store = InMemoryStore()
    await store.create_alert_rule(_free_ssid_rule())

    inserted = await batch_insert_events({"store": store}, [_free_ssid_event()])

    assert inserted == 1
    assert store.events[0].id == "evt-1"
    assert len(store.alerts) == 1


async def test_alert_worker_generates_insight_when_llm_enabled() -> None:
    """Alert creation triggers the alert-context insight worker path."""

    store = InMemoryStore()
    client = FakeLlmClient()
    await store.create_alert_rule(_free_ssid_rule())

    alerts = await evaluate_alerts(
        _llm_context(store, client),
        _free_ssid_event(),
    )

    assert alerts[0]["rule_id"] == "rule-1"
    assert len(client.calls) == 1
    assert store.audit_logs[-1].action == "llm.insight.alert_context"


def _free_ssid_rule() -> AlertRule:
    return AlertRule(
        id="rule-1",
        name="Free SSID",
        severity=AlertSeverity.HIGH,
        predicate={"event_kind": "access_point_seen", "match": {"ssid": "^Free"}},
        created_by="user-1",
    )


def _free_ssid_event() -> dict[str, object]:
    return {
        "id": "evt-1",
        "sensor_id": "pi-1",
        "kind": "access_point_seen",
        "payload": {"ssid": "Free Lab"},
    }


def _llm_context(store: InMemoryStore, client: FakeLlmClient) -> dict[str, object]:
    return {
        "store": store,
        "settings": Settings(
            env="test",
            cookie_secure=False,
            jwt_secret="j" * 32,
            bootstrap_token="bootstrap-token-test",
            use_in_memory_store=True,
            llm_enabled=True,
            llm_api_base_url="http://localhost:11434/v1",
        ),
        "llm_client": client,
        "insight_cache": InMemoryInsightCache(),
        "usage_ledger": InMemoryUsageLedger(),
        "prompt_templates": PromptTemplates.load(),
        "prompt_redactor": PromptRedactor(),
    }
