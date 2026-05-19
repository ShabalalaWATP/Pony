# SPDX-License-Identifier: AGPL-3.0-only
"""Synthetic demo stream producer and relay."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from time import monotonic
from typing import Protocol, runtime_checkable
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.operator_events import (
    OperatorPublisher,
    publish_access_point_upsert,
    publish_alert_fire,
    publish_client_upsert,
    publish_event_append,
)
from cheeky_pony_backend.infra.demo_dataset import DemoDataset, build_demo_dataset
from cheeky_pony_shared import AccessPoint, Alert, Client, Event
from cheeky_pony_shared.models import utc_now

LOGGER = logging.getLogger(__name__)
DEFAULT_STREAM_RATE_PER_MINUTE = 30
MAX_STREAM_RATE_PER_MINUTE = 600
DEMO_STREAM_POLL_SECONDS = 0.25
FAKE_MAC_PREFIX = "02:00:"
STREAM_TOPIC_SEQUENCE = (
    *(["events.append"] * 12),
    *(["aps.upsert"] * 5),
    *(["devices.upsert"] * 2),
    "alerts.fire",
)


class DemoStreamKind(StrEnum):
    """Operator topics emitted by the synthetic demo stream."""

    EVENT_APPEND = "events.append"
    ACCESS_POINT_UPSERT = "aps.upsert"
    CLIENT_UPSERT = "devices.upsert"
    ALERT_FIRE = "alerts.fire"


class DemoStreamRecord(BaseModel):
    """Queued synthetic operator topic for the backend relay."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=128)
    kind: DemoStreamKind
    payload: dict[str, object]
    created_at: datetime = Field(default_factory=utc_now)
    synthetic: bool = True


@dataclass(frozen=True)
class DemoStreamOptions:
    """Runtime options for streaming synthetic operator topics."""

    rate_per_minute: int = DEFAULT_STREAM_RATE_PER_MINUTE
    duration_seconds: float = 0
    actor_id: str = "system:seed"


@dataclass(frozen=True)
class DemoStreamSummary:
    """Summary of a completed synthetic stream run."""

    emitted: int


@runtime_checkable
class DemoStreamQueue(Protocol):
    """Persistence boundary for cross-process demo stream records."""

    async def enqueue_demo_stream_record(self, record: DemoStreamRecord) -> DemoStreamRecord:
        """Queue one synthetic stream record."""

    async def pending_demo_stream_records(self, limit: int) -> list[DemoStreamRecord]:
        """Return queued records in insertion order."""

    async def delete_demo_stream_record(self, record_id: str) -> None:
        """Remove one queued record after relay."""


def demo_stream_queue(candidate: object) -> DemoStreamQueue | None:
    """Return the demo stream queue interface when a store supports it.

    Args:
        candidate: Store-like object.

    Returns:
        Demo stream queue implementation or None.
    """

    return candidate if isinstance(candidate, DemoStreamQueue) else None


class DemoStreamProducer:
    """Build deterministic synthetic operator topic records."""

    def __init__(self, dataset: DemoDataset, stream_id: str | None = None) -> None:
        self._dataset = dataset
        self._stream_id = stream_id or uuid4().hex[:12]
        self._sequence = 0

    @classmethod
    def from_seed_dataset(cls) -> DemoStreamProducer:
        """Create a producer from the standard deterministic demo dataset."""

        return cls(build_demo_dataset(datetime.now(tz=UTC), with_active=False))

    def next_record(self, observed_at: datetime | None = None) -> DemoStreamRecord:
        """Return the next synthetic stream record.

        Args:
            observed_at: Timestamp to stamp onto live-ish generated entities.

        Returns:
            Queued operator topic record.
        """

        sequence = self._sequence
        self._sequence += 1
        kind = DemoStreamKind(STREAM_TOPIC_SEQUENCE[sequence % len(STREAM_TOPIC_SEQUENCE)])
        timestamp = observed_at or datetime.now(tz=UTC) - timedelta(seconds=5)
        if kind == DemoStreamKind.EVENT_APPEND:
            return self._event_record(sequence, timestamp)
        if kind == DemoStreamKind.ACCESS_POINT_UPSERT:
            return self._access_point_record(sequence, timestamp)
        if kind == DemoStreamKind.CLIENT_UPSERT:
            return self._client_record(sequence, timestamp)
        return self._alert_record(sequence)

    def _event_record(self, sequence: int, observed_at: datetime) -> DemoStreamRecord:
        event = self._dataset.events[sequence % len(self._dataset.events)]
        payload = dict(event.payload)
        payload["synthetic"] = True
        streamed = event.model_copy(
            update={
                "id": f"synth-stream-event-{self._stream_id}-{sequence:08d}",
                "occurred_at": observed_at,
                "payload": payload,
                "synthetic": True,
            }
        )
        return _record(self._stream_id, sequence, DemoStreamKind.EVENT_APPEND, streamed)

    def _access_point_record(self, sequence: int, observed_at: datetime) -> DemoStreamRecord:
        access_point = self._dataset.access_points[sequence % len(self._dataset.access_points)]
        streamed = access_point.model_copy(update={"last_seen": observed_at, "synthetic": True})
        return _record(self._stream_id, sequence, DemoStreamKind.ACCESS_POINT_UPSERT, streamed)

    def _client_record(self, sequence: int, observed_at: datetime) -> DemoStreamRecord:
        client = self._dataset.clients[sequence % len(self._dataset.clients)]
        streamed = client.model_copy(update={"last_seen": observed_at, "synthetic": True})
        return _record(self._stream_id, sequence, DemoStreamKind.CLIENT_UPSERT, streamed)

    def _alert_record(self, sequence: int) -> DemoStreamRecord:
        alert = self._dataset.alerts[sequence % len(self._dataset.alerts)]
        streamed = alert.model_copy(
            update={"id": f"synth-stream-alert-{self._stream_id}-{sequence:08d}", "synthetic": True}
        )
        return _record(self._stream_id, sequence, DemoStreamKind.ALERT_FIRE, streamed)


class DemoStreamRelay:
    """Relay queued demo stream records through the operator broker."""

    def __init__(self, queue: DemoStreamQueue, publisher: OperatorPublisher) -> None:
        self._queue = queue
        self._publisher = publisher

    async def run(self) -> None:
        """Poll for stream records until the task is cancelled."""

        while True:
            await self.flush_once(100)
            await asyncio.sleep(DEMO_STREAM_POLL_SECONDS)

    async def flush_once(self, limit: int = 100) -> int:
        """Publish and delete one bounded batch of queued records.

        Args:
            limit: Maximum records to relay.

        Returns:
            Number of records removed from the queue.
        """

        records = await self._queue.pending_demo_stream_records(limit)
        for record in records:
            try:
                await publish_demo_stream_record(self._publisher, record)
            except ValidationError as exc:
                LOGGER.warning("dropping invalid demo stream record %s: %s", record.id, exc)
            finally:
                await self._queue.delete_demo_stream_record(record.id)
        return len(records)


async def stream_demo_records(
    queue: DemoStreamQueue,
    audit: AuditLogger,
    options: DemoStreamOptions,
) -> DemoStreamSummary:
    """Queue synthetic stream records at the requested cadence.

    Args:
        queue: Cross-process stream queue.
        audit: Audit logger for start and stop markers.
        options: Stream runtime options.

    Returns:
        Emission count summary.
    """

    _validate_stream_options(options)
    await audit.record(
        options.actor_id,
        "demo.stream.start",
        {},
        {"rate_per_minute": options.rate_per_minute, "duration_seconds": options.duration_seconds},
        "ok",
    )
    emitted = 0
    producer = DemoStreamProducer.from_seed_dataset()
    interval = 60 / options.rate_per_minute
    deadline = _deadline(options.duration_seconds)
    next_emit = monotonic()
    try:
        while _should_continue(deadline):
            await queue.enqueue_demo_stream_record(producer.next_record())
            emitted += 1
            next_emit += interval
            await asyncio.sleep(_sleep_seconds(next_emit, deadline))
    finally:
        await audit.record(
            options.actor_id,
            "demo.stream.stop",
            {},
            {
                "duration_seconds": options.duration_seconds,
                "emitted": emitted,
                "rate_per_minute": options.rate_per_minute,
            },
            "ok",
        )
    return DemoStreamSummary(emitted=emitted)


async def publish_demo_stream_record(
    publisher: OperatorPublisher,
    record: DemoStreamRecord,
) -> None:
    """Publish one queued synthetic topic through shared operator helpers.

    Args:
        publisher: Operator broadcast boundary.
        record: Queued synthetic stream record.
    """

    if not record.synthetic or record.payload.get("synthetic") is not True:
        return
    if record.kind == DemoStreamKind.EVENT_APPEND:
        event = Event.model_validate(record.payload)
        if event.synthetic:
            await publish_event_append(publisher, event)
        return
    if record.kind == DemoStreamKind.ACCESS_POINT_UPSERT:
        access_point = AccessPoint.model_validate(record.payload)
        if access_point.synthetic and _fake_mac(access_point.bssid):
            await publish_access_point_upsert(publisher, access_point)
        return
    if record.kind == DemoStreamKind.CLIENT_UPSERT:
        client = Client.model_validate(record.payload)
        if client.synthetic and _fake_mac(client.mac):
            await publish_client_upsert(publisher, client)
        return
    alert = Alert.model_validate(record.payload)
    if alert.synthetic:
        await publish_alert_fire(publisher, alert)


def _record(
    stream_id: str,
    sequence: int,
    kind: DemoStreamKind,
    payload: BaseModel,
) -> DemoStreamRecord:
    return DemoStreamRecord(
        id=f"synth-stream-{stream_id}-{sequence:08d}",
        kind=kind,
        payload=_payload(payload),
    )


def _payload(model: BaseModel) -> dict[str, object]:
    data = model.model_dump(mode="json")
    return {str(key): value for key, value in data.items()}


def _validate_stream_options(options: DemoStreamOptions) -> None:
    if not 1 <= options.rate_per_minute <= MAX_STREAM_RATE_PER_MINUTE:
        raise ValueError("stream rate must be between 1 and 600 events/min")
    if options.duration_seconds < 0:
        raise ValueError("stream duration must be non-negative")


def _deadline(duration_seconds: float) -> float | None:
    if duration_seconds <= 0:
        return None
    return monotonic() + duration_seconds


def _should_continue(deadline: float | None) -> bool:
    return deadline is None or monotonic() < deadline


def _sleep_seconds(next_emit: float, deadline: float | None) -> float:
    sleep_for = max(0.0, next_emit - monotonic())
    if deadline is None:
        return sleep_for
    return max(0.0, min(sleep_for, deadline - monotonic()))


def _fake_mac(value: str) -> bool:
    return value.upper().startswith(FAKE_MAC_PREFIX)
