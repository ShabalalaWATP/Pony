# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for worker task functions."""

from __future__ import annotations

import pytest

from cheeky_pony_backend.workers.tasks import (
    batch_insert_events,
    enrich_oui_vendor,
    evaluate_alerts,
)

pytestmark = pytest.mark.asyncio


async def test_worker_tasks_return_expected_placeholders() -> None:
    """Worker task placeholders are deterministic."""

    assert await batch_insert_events({}, [{"id": "evt-1"}]) == 1
    assert await enrich_oui_vendor({}, "AA:BB:CC:00:00:00") == "unknown"
    assert await enrich_oui_vendor({}, "") is None
    assert await evaluate_alerts({}, {"id": "evt-1"}) == []
