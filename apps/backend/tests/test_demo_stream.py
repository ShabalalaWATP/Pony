# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for synthetic demo stream publication."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

import pytest

from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.infra.demo_stream import (
    DemoStreamKind,
    DemoStreamOptions,
    DemoStreamProducer,
    DemoStreamRecord,
    DemoStreamRelay,
    _deadline,
    _sleep_seconds,
    publish_demo_stream_record,
    stream_demo_records,
)
from cheeky_pony_backend.infra.in_memory_store import InMemoryStore


async def test_demo_stream_publishes_every_topic_kind() -> None:
    """Stream records publish each supported operator topic kind."""

    publisher = RecordingPublisher()
    producer = DemoStreamProducer.from_seed_dataset()
    timestamp = datetime(2026, 5, 19, 12, tzinfo=UTC)

    for _ in range(20):
        await publish_demo_stream_record(publisher, producer.next_record(timestamp))

    kinds = [message["kind"] for message in publisher.messages]
    assert kinds.count("events.append") == 12
    assert kinds.count("aps.upsert") == 5
    assert kinds.count("devices.upsert") == 2
    assert kinds.count("alerts.fire") == 1


async def test_demo_stream_ignores_unsafe_or_invalid_records() -> None:
    """The relay drops non-synthetic and invalid queue records."""

    publisher = RecordingPublisher()
    unsafe = DemoStreamRecord(
        id="synth-stream-unsafe",
        kind=DemoStreamKind.ALERT_FIRE,
        payload={"synthetic": False},
    )
    invalid = DemoStreamRecord(
        id="synth-stream-invalid",
        kind=DemoStreamKind.ACCESS_POINT_UPSERT,
        payload={"synthetic": True},
    )
    queue = FakeDemoStreamQueue([unsafe, invalid])

    relayed = await DemoStreamRelay(queue, publisher).flush_once()

    assert relayed == 2
    assert queue.records == []
    assert publisher.messages == []


async def test_demo_stream_relay_run_cancels_cleanly() -> None:
    """The background relay loop cooperates with application shutdown."""

    task = asyncio.create_task(DemoStreamRelay(FakeDemoStreamQueue(), RecordingPublisher()).run())
    await asyncio.sleep(0)

    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task


async def test_demo_stream_option_validation_rejects_bad_values() -> None:
    """Invalid stream cadence options fail before auditing or enqueueing."""

    queue = FakeDemoStreamQueue()
    audit = AuditLogger(InMemoryStore())

    with pytest.raises(ValueError, match="rate"):
        await stream_demo_records(queue, audit, DemoStreamOptions(rate_per_minute=0))
    with pytest.raises(ValueError, match="duration"):
        await stream_demo_records(queue, audit, DemoStreamOptions(duration_seconds=-1))

    assert queue.records == []


def test_demo_stream_deadline_helpers_cover_open_ended_mode() -> None:
    """Open-ended stream mode has no deadline and sleeps against the next emit time."""

    assert _deadline(0) is None
    assert _sleep_seconds(0, None) == 0


class FakeDemoStreamQueue:
    """In-memory demo stream queue for relay tests."""

    def __init__(self, records: list[DemoStreamRecord] | None = None) -> None:
        self.records = records or []

    async def enqueue_demo_stream_record(self, record: DemoStreamRecord) -> DemoStreamRecord:
        """Queue one stream record."""

        self.records.append(record)
        return record

    async def pending_demo_stream_records(self, limit: int) -> list[DemoStreamRecord]:
        """Return queued stream records."""

        return list(self.records[:limit])

    async def delete_demo_stream_record(self, record_id: str) -> None:
        """Remove a queued stream record."""

        self.records = [record for record in self.records if record.id != record_id]


class RecordingPublisher:
    """Operator publisher stand-in that records payloads."""

    def __init__(self) -> None:
        self.messages: list[dict[str, Any]] = []

    async def broadcast(self, payload: dict[str, Any]) -> None:
        """Record one broadcast payload."""

        self.messages.append(payload)
