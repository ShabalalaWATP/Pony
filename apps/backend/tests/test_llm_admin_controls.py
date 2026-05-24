# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for LLM admin controls and telemetry."""

from __future__ import annotations

import pytest
from conftest import BackendClient
from helpers import create_verified_admin

from cheeky_pony_backend.infra.in_memory_store import InMemoryStore
from cheeky_pony_shared import Alert, AlertRule, AlertSeverity

pytestmark = pytest.mark.asyncio


async def test_refresh_endpoint_bypasses_cached_alert_insight(
    backend_client: BackendClient,
) -> None:
    """Admin refresh forces a second model call and refresh-specific audit row."""

    csrf = await create_verified_admin(backend_client)
    backend_client.settings.llm_enabled = True
    await _seed_alert(backend_client.store)

    first = await backend_client.client.get("/api/v1/insights/alert/alert-admin")
    refresh = await backend_client.client.post(
        "/api/v1/insights/alert_context/alert-admin/refresh",
        headers={"x-csrf-token": csrf},
    )

    assert first.status_code == 200
    assert refresh.status_code == 200
    assert refresh.json()["cached"] is False
    assert backend_client.llm_client is not None
    assert len(backend_client.llm_client.calls) == 2
    assert backend_client.store.audit_logs[-1].action == "llm.insight.alert_context.refresh"
    assert backend_client.store.audit_logs[-1].parameters["outcome"] == "generated"


async def test_invalid_refresh_payload_audits_refusal(
    backend_client: BackendClient,
) -> None:
    """Refresh validation failures audit before FastAPI returns 422."""

    csrf = await create_verified_admin(backend_client)

    response = await backend_client.client.post(
        "/api/v1/insights/unknown/alert-admin/refresh",
        headers={"x-csrf-token": csrf},
    )

    assert response.status_code == 422
    assert backend_client.store.audit_logs[-1].action == "llm.insight.refresh"
    assert backend_client.store.audit_logs[-1].outcome == "denied:invalid_payload"


async def test_usage_endpoint_reports_counts_without_prompt_content(
    backend_client: BackendClient,
) -> None:
    """Usage telemetry summarizes hashes and counts without raw prompt data."""

    await create_verified_admin(backend_client)
    backend_client.settings.llm_enabled = True
    await _seed_alert(backend_client.store)
    await backend_client.client.get("/api/v1/insights/alert/alert-admin")
    await backend_client.client.get("/api/v1/insights/alert/alert-admin")

    response = await backend_client.client.get("/api/v1/insights/usage")

    assert response.status_code == 200
    body = response.json()
    alert_usage = next(item for item in body["last_30_days"] if item["kind"] == "alert_context")
    assert alert_usage == {"kind": "alert_context", "generated": 1, "cached": 1}
    assert body["recent_audit_entries"][0]["prompt_hash"].startswith("sha256:")
    assert "FREE-WIFI" not in response.text
    assert "This alert matched" not in response.text


async def test_usage_endpoint_is_admin_only(backend_client: BackendClient) -> None:
    """Operator sessions cannot read LLM usage telemetry and the refusal audits."""

    await create_verified_admin(backend_client)
    admin = await backend_client.store.get_user_by_email("admin@example.com")
    assert admin is not None
    await backend_client.store.update_user(admin.model_copy(update={"roles": ["operator"]}))

    response = await backend_client.client.get("/api/v1/insights/usage")

    assert response.status_code == 403
    assert response.json()["detail"] == "admin_required"
    assert backend_client.store.audit_logs[-1].action == "llm.usage.read"
    assert backend_client.store.audit_logs[-1].outcome == "denied:admin_required"


async def test_kill_switch_disables_and_reenables_generation(
    backend_client: BackendClient,
) -> None:
    """Runtime kill switch blocks LLM calls until an admin clears it."""

    csrf = await create_verified_admin(backend_client)
    backend_client.settings.llm_enabled = True
    await _seed_alert(backend_client.store)

    disabled = await backend_client.client.post(
        "/api/v1/insights/kill-switch",
        headers={"x-csrf-token": csrf},
        json={"enable": False, "confirm": "DISABLE"},
    )
    blocked = await backend_client.client.get("/api/v1/insights/alert/alert-admin")
    enabled = await backend_client.client.post(
        "/api/v1/insights/kill-switch",
        headers={"x-csrf-token": csrf},
        json={"enable": True, "confirm": "ENABLE"},
    )
    generated = await backend_client.client.get("/api/v1/insights/alert/alert-admin")

    assert disabled.status_code == 200
    assert disabled.json()["runtime_disabled"] is True
    assert disabled.json()["effective_enabled"] is False
    assert blocked.status_code == 503
    assert blocked.json()["reason"] == "disabled"
    assert enabled.status_code == 200
    assert enabled.json()["runtime_disabled"] is False
    assert enabled.json()["effective_enabled"] is True
    assert generated.status_code == 200
    assert backend_client.llm_client is not None
    assert len(backend_client.llm_client.calls) == 1


async def test_kill_switch_confirm_mismatch_audits_refusal(
    backend_client: BackendClient,
) -> None:
    """Typed-confirm mismatch refuses without changing the runtime flag."""

    csrf = await create_verified_admin(backend_client)
    backend_client.settings.llm_enabled = True

    response = await backend_client.client.post(
        "/api/v1/insights/kill-switch",
        headers={"x-csrf-token": csrf},
        json={"enable": False, "confirm": "ENABLE"},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "confirm_mismatch"
    assert backend_client.runtime_flags is not None
    assert await backend_client.runtime_flags.llm_disabled() is False
    assert backend_client.store.audit_logs[-1].action == "llm.kill_switch.toggle"
    assert backend_client.store.audit_logs[-1].outcome == "denied:confirm_mismatch"


async def test_kill_switch_cannot_override_disabled_env(
    backend_client: BackendClient,
) -> None:
    """Clearing the runtime switch does not bypass LLM_ENABLED=false."""

    csrf = await create_verified_admin(backend_client)

    response = await backend_client.client.post(
        "/api/v1/insights/kill-switch",
        headers={"x-csrf-token": csrf},
        json={"enable": True, "confirm": "ENABLE"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "env_enabled": False,
        "effective_enabled": False,
        "runtime_disabled": False,
    }


async def _seed_alert(store: InMemoryStore) -> None:
    await store.create_alert_rule(
        AlertRule(
            id="rule-admin",
            name="Suspicious SSID",
            description="Matches suspicious free networks.",
            severity=AlertSeverity.HIGH,
            predicate={"event_kind": "access_point_seen", "match": {"ssid": "FREE"}},
            created_by="admin",
        )
    )
    await store.insert_alert(
        Alert(
            id="alert-admin",
            rule_id="rule-admin",
            severity=AlertSeverity.HIGH,
            related_entities=["AA:BB:CC:DD:EE:FF", "FREE-WIFI"],
        )
    )
