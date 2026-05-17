# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for engagement and allow-list routes."""

from __future__ import annotations

import pytest
from conftest import BackendClient
from helpers import create_verified_admin

from cheeky_pony_shared import TargetKind

pytestmark = pytest.mark.asyncio


async def test_create_engagement_and_allow_target(backend_client: BackendClient) -> None:
    """A verified admin can create an engagement and add an allowed target."""

    csrf = await create_verified_admin(backend_client)
    created = await backend_client.client.post(
        "/api/v1/engagements",
        json={"name": "Lab", "scope_rules": [{"kind": "ssid", "value": "Lab"}]},
        headers={"x-csrf-token": csrf},
    )

    engagement_id = created.json()["id"]
    allowed = await backend_client.client.post(
        f"/api/v1/engagements/{engagement_id}/allow-list",
        json={"kind": "bssid", "value": "AA:BB:CC:DD:EE:FF"},
        headers={"x-csrf-token": csrf},
    )

    assert created.status_code == 200
    assert allowed.status_code == 204
    assert await backend_client.store.target_allowed(
        engagement_id,
        TargetKind.BSSID,
        "AA:BB:CC:DD:EE:FF",
    )


async def test_active_engagement_and_endpoints(backend_client: BackendClient) -> None:
    """Engagements expose the single active engagement and can be ended."""

    csrf = await create_verified_admin(backend_client)
    created = await backend_client.client.post(
        "/api/v1/engagements",
        json={"name": "Lab"},
        headers={"x-csrf-token": csrf},
    )
    active = await backend_client.client.get("/api/v1/engagements/active")
    duplicate = await backend_client.client.post(
        "/api/v1/engagements",
        json={"name": "Second"},
        headers={"x-csrf-token": csrf},
    )
    ended = await backend_client.client.post(
        f"/api/v1/engagements/{created.json()['id']}/end",
        headers={"x-csrf-token": csrf},
    )
    missing = await backend_client.client.get("/api/v1/engagements/active")

    assert created.status_code == 200
    assert active.status_code == 200
    assert duplicate.status_code == 409
    assert ended.status_code == 204
    assert missing.status_code == 404
