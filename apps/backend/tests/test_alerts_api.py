# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for alert and alert-rule API routes."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from conftest import BackendClient
from helpers import create_verified_admin

from cheeky_pony_shared import Alert, AlertSeverity

pytestmark = pytest.mark.asyncio


async def test_alerts_can_be_filtered_and_acked(backend_client: BackendClient) -> None:
    """Authenticated users can list and acknowledge alerts."""

    csrf = await create_verified_admin(backend_client)
    await backend_client.store.insert_alert(
        Alert(
            id="alert-1",
            rule_id="rule-1",
            severity=AlertSeverity.HIGH,
            related_entities=["AA:BB:CC:DD:EE:FF"],
        )
    )
    await backend_client.store.insert_alert(
        Alert(
            id="alert-2",
            rule_id="rule-2",
            severity=AlertSeverity.LOW,
            acked_by="user-2",
            acked_at=datetime(2026, 1, 1, tzinfo=UTC),
        )
    )

    listed = await backend_client.client.get(
        "/api/v1/alerts",
        params={"severity": "high", "acked": "false"},
    )
    acked = await backend_client.client.post(
        "/api/v1/alerts/alert-1/ack",
        headers={"x-csrf-token": csrf},
    )
    missing = await backend_client.client.post(
        "/api/v1/alerts/missing/ack",
        headers={"x-csrf-token": csrf},
    )

    assert listed.status_code == 200
    assert listed.json()["total"] == 1
    assert listed.json()["items"][0]["id"] == "alert-1"
    assert acked.status_code == 204
    assert missing.status_code == 404
    assert backend_client.store.alerts["alert-1"].acked_at is not None
    assert backend_client.store.audit_logs[-1].action == "alerts.ack"


async def test_alert_rule_admin_lifecycle_is_audited(
    backend_client: BackendClient,
) -> None:
    """Verified admins can manage alert rules and each mutation is audited."""

    csrf = await create_verified_admin(backend_client)
    created = await backend_client.client.post(
        "/api/v1/alerts/rules",
        headers={"x-csrf-token": csrf},
        json={
            "name": "Free SSID",
            "description": "Find suspicious free-network SSIDs.",
            "severity": "high",
            "enabled": True,
            "predicate": {"event_kind": "access_point_seen", "match": {"ssid": "^Free"}},
        },
    )

    rule_id = created.json()["id"]
    listed = await backend_client.client.get("/api/v1/alerts/rules")
    patched = await backend_client.client.patch(
        f"/api/v1/alerts/rules/{rule_id}",
        headers={"x-csrf-token": csrf},
        json={"enabled": False},
    )
    deleted = await backend_client.client.delete(
        f"/api/v1/alerts/rules/{rule_id}",
        headers={"x-csrf-token": csrf},
    )

    assert created.status_code == 200
    assert listed.status_code == 200
    assert listed.json()["total"] == 1
    assert patched.status_code == 200
    assert patched.json()["enabled"] is False
    assert deleted.status_code == 204
    assert [log.action for log in backend_client.store.audit_logs[-3:]] == [
        "alerts.rules.create",
        "alerts.rules.update",
        "alerts.rules.delete",
    ]


async def test_alert_rule_predicates_are_validated(backend_client: BackendClient) -> None:
    """Alert rule predicates reject unsupported JSON shapes."""

    csrf = await create_verified_admin(backend_client)
    response = await backend_client.client.post(
        "/api/v1/alerts/rules",
        headers={"x-csrf-token": csrf},
        json={
            "name": "Bad",
            "severity": "medium",
            "predicate": {"unsupported": True},
        },
    )

    assert response.status_code == 422


async def test_alert_rule_rejects_redos_prone_regex(backend_client: BackendClient) -> None:
    """Alert rule predicates reject nested quantifier regex patterns."""

    csrf = await create_verified_admin(backend_client)
    response = await backend_client.client.post(
        "/api/v1/alerts/rules",
        headers={"x-csrf-token": csrf},
        json={
            "name": "Catastrophic",
            "severity": "medium",
            "predicate": {"event_kind": "access_point_seen", "match": {"ssid": "^(a+)+$"}},
        },
    )

    assert response.status_code == 422
