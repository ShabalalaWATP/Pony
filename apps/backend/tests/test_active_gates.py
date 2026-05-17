# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for active-operation authorization gates."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.active_gates import ActiveGateDeniedError, ActiveGateService
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.infra.in_memory_store import InMemoryStore
from cheeky_pony_shared import Engagement, SystemAcknowledgement, TargetKind

pytestmark = pytest.mark.asyncio


async def test_active_gate_denies_without_lab_mode_and_audits() -> None:
    """Missing lab mode returns 403 and appends an audit entry."""

    store = InMemoryStore()
    actor = UserRecord(
        id="user-1",
        email="admin@example.com",
        password_hash="hash",
        roles=["admin"],
    )
    service = ActiveGateService(
        Settings(env="test", lab_mode=False, jwt_secret="test-secret-test-secret-test-secret-123"),
        store,
        AuditLogger(store),
    )

    with pytest.raises(ActiveGateDeniedError) as exc_info:
        await service.authorize(
            actor,
            "active.deauth",
            "eng-1",
            TargetKind.BSSID,
            "AA:BB:CC:DD:EE:FF",
            {"reason": "test"},
        )

    assert exc_info.value.reason == "lab_mode_disabled"
    assert store.audit_logs[0].outcome == "denied:lab_mode_disabled"


async def test_active_gate_allows_only_when_all_gates_pass() -> None:
    """Lab mode, acknowledgement, and allow-list must all pass."""

    store = InMemoryStore()
    actor = UserRecord(
        id="user-1",
        email="admin@example.com",
        password_hash="hash",
        roles=["admin"],
        totp_verified_at=datetime.now(tz=UTC),
    )
    await store.create_engagement(Engagement(id="eng-1", name="Lab"))
    await store.allow_target("eng-1", TargetKind.BSSID, "AA:BB:CC:DD:EE:FF")
    await store.create_acknowledgement(
        SystemAcknowledgement(
            kind="authorized_operator",
            accepted_by="user-1",
            statement_hash="x" * 64,
        )
    )
    service = ActiveGateService(
        Settings(env="test", lab_mode=True, jwt_secret="test-secret-test-secret-test-secret-123"),
        store,
        AuditLogger(store),
    )

    await service.authorize(
        actor,
        "active.deauth",
        "eng-1",
        TargetKind.BSSID,
        "AA:BB:CC:DD:EE:FF",
        {"reason": "test"},
    )

    assert store.audit_logs == []
