# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for LLM insight service and API integration."""

from __future__ import annotations

import pytest
from conftest import BackendClient
from helpers import create_verified_admin

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.infra.in_memory_store import InMemoryStore
from cheeky_pony_backend.llm.budget import InMemoryUsageLedger, current_budget_month
from cheeky_pony_backend.llm.cache import InMemoryInsightCache
from cheeky_pony_backend.llm.errors import LlmBudgetExceededError, LlmOutputValidationError
from cheeky_pony_backend.llm.fake_client import FakeLlmClient
from cheeky_pony_backend.llm.prompts import PromptTemplates
from cheeky_pony_backend.llm.redactor import PromptRedactor
from cheeky_pony_backend.llm.runtime_flags import InMemoryLlmRuntimeFlags
from cheeky_pony_backend.llm.service import LlmInsightService
from cheeky_pony_shared import Alert, AlertRule, AlertSeverity

pytestmark = pytest.mark.asyncio


async def test_alert_insight_route_generates_then_uses_cache(
    backend_client: BackendClient,
) -> None:
    """GET alert insight generates once and serves subsequent calls from cache."""

    await create_verified_admin(backend_client)
    backend_client.settings.llm_enabled = True
    await _seed_alert(backend_client.store)

    first = await backend_client.client.get("/api/v1/insights/alert/alert-1")
    second = await backend_client.client.get("/api/v1/insights/alert/alert-1")

    assert first.status_code == 200
    assert first.json()["cached"] is False
    assert second.status_code == 200
    assert second.json()["cached"] is True
    assert backend_client.llm_client is not None
    assert backend_client.usage_ledger is not None
    assert len(backend_client.llm_client.calls) == 1
    assert await backend_client.usage_ledger.current_month_spend(current_budget_month()) > 0
    assert [log.parameters["outcome"] for log in backend_client.store.audit_logs[-2:]] == [
        "generated",
        "cached",
    ]


async def test_alert_insight_route_returns_unavailable_when_disabled(
    backend_client: BackendClient,
) -> None:
    """The kill switch short-circuits route calls without dispatching."""

    await create_verified_admin(backend_client)
    await _seed_alert(backend_client.store)

    response = await backend_client.client.get("/api/v1/insights/alert/alert-1")

    assert response.status_code == 503
    assert response.json() == {"detail": "llm_unavailable", "reason": "disabled"}
    assert backend_client.llm_client is not None
    assert backend_client.llm_client.calls == []
    assert backend_client.store.audit_logs[-1].parameters["outcome"] == "disabled"


async def test_alert_insight_route_returns_404_for_unknown_alert(
    backend_client: BackendClient,
) -> None:
    """Unknown alerts are not generated and return 404."""

    await create_verified_admin(backend_client)
    backend_client.settings.llm_enabled = True

    response = await backend_client.client.get("/api/v1/insights/alert/missing")

    assert response.status_code == 404
    assert backend_client.store.audit_logs[-1].parameters["outcome"] == "refused"


async def test_service_rejects_invalid_output_without_cache() -> None:
    """Malformed LLM output is audited and never cached."""

    store = InMemoryStore()
    await _seed_alert(store)
    cache = InMemoryInsightCache()
    service = LlmInsightService(
        client=FakeLlmClient(default_response='{"summary": 123}'),
        cache=cache,
        ledger=InMemoryUsageLedger(),
        redactor=PromptRedactor(),
        templates=PromptTemplates.load(),
        audit=AuditLogger(store),
        settings=_settings(),
        store=store,
        runtime_flags=InMemoryLlmRuntimeFlags(),
    )

    with pytest.raises(LlmOutputValidationError):
        await service.alert_context("alert-1", actor_id="user-1")

    assert cache.records == {}
    assert store.audit_logs[-1].parameters["outcome"] == "validation_failed"


async def test_service_budget_exceeded_is_audited() -> None:
    """Budget preflight blocks dispatch before the client is called."""

    store = InMemoryStore()
    await _seed_alert(store)
    client = FakeLlmClient()
    settings = _settings()
    settings.llm_budget_usd_monthly = 0.00000001
    service = LlmInsightService(
        client=client,
        cache=InMemoryInsightCache(),
        ledger=InMemoryUsageLedger(),
        redactor=PromptRedactor(),
        templates=PromptTemplates.load(),
        audit=AuditLogger(store),
        settings=settings,
        store=store,
        runtime_flags=InMemoryLlmRuntimeFlags(),
    )

    response = await _budget_failure(service)

    assert response == "budget_exceeded"
    assert client.calls == []
    assert store.audit_logs[-1].parameters["outcome"] == "budget_exceeded"


async def _budget_failure(service: LlmInsightService) -> str:
    try:
        await service.alert_context("alert-1", actor_id="user-1")
    except LlmBudgetExceededError as exc:
        return str(exc)
    return "not_failed"


async def _seed_alert(store: InMemoryStore) -> None:
    await store.create_alert_rule(
        AlertRule(
            id="rule-1",
            name="Suspicious SSID",
            description="Matches suspicious free networks.",
            severity=AlertSeverity.HIGH,
            predicate={"event_kind": "access_point_seen", "match": {"ssid": "FREE"}},
            created_by="admin",
        )
    )
    await store.insert_alert(
        Alert(
            id="alert-1",
            rule_id="rule-1",
            severity=AlertSeverity.HIGH,
            related_entities=["AA:BB:CC:DD:EE:FF", "FREE-WIFI"],
        )
    )


def _settings() -> Settings:
    return Settings(
        env="test",
        cookie_secure=False,
        jwt_secret="j" * 32,
        bootstrap_token="bootstrap-token-test",
        use_in_memory_store=True,
        llm_enabled=True,
        llm_api_base_url="http://localhost:11434/v1",
        llm_model="gpt-4o-mini",
    )
