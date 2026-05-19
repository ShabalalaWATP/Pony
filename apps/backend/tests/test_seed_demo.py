# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for the synthetic demo seeder."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

import pytest

import cheeky_pony_backend.infra.seed_demo as seed_demo
from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.infra.demo_dataset import EVENT_COUNT, build_demo_dataset
from cheeky_pony_backend.infra.demo_stream import (
    DemoStreamKind,
    DemoStreamOptions,
    DemoStreamProducer,
    DemoStreamRecord,
    DemoStreamRelay,
    DemoStreamSummary,
    stream_demo_records,
)
from cheeky_pony_backend.infra.in_memory_store import InMemoryStore
from cheeky_pony_backend.infra.mongo_store import MongoStore
from cheeky_pony_backend.infra.operator_broker import OperatorBroker
from cheeky_pony_backend.infra.seed_demo import SeedOptions, _clean, _refusal_reason, _seed
from cheeky_pony_backend.infra.signals_repo import SIGNAL_HISTORY_CAP
from cheeky_pony_shared import AccessPoint, Event, EventKind, Sensor


@pytest.fixture
def mongo_store() -> Iterator[MongoStore]:
    """Start a MongoDB testcontainer for seeder tests."""

    mongodb = pytest.importorskip("testcontainers.mongodb")
    container = mongodb.MongoDbContainer("mongo:7.0")
    try:
        container.start()
    except Exception as exc:
        pytest.skip(f"MongoDB testcontainer unavailable: {exc}")
    store = MongoStore(container.get_connection_url(), "seed_demo_test")
    try:
        yield store
    finally:
        store.client.close()
        container.stop()


@pytest.mark.slow
async def test_seed_demo_counts_idempotency_and_clean(mongo_store: MongoStore) -> None:
    """Seeder writes expected counts, is idempotent, and cleans only synthetic rows."""

    await mongo_store.ensure_indexes()
    await mongo_store.db.access_points.insert_one(
        AccessPoint(bssid="AA:BB:CC:DD:EE:FF", ssid="Real").model_dump(mode="json")
    )
    options = SeedOptions(clean=False, with_active=False, force=False, actor_id="tester")

    counts = await _seed(mongo_store, options)
    await _seed(mongo_store, options)

    assert counts == {
        "sensors": 3,
        "access_points": 50,
        "clients": 200,
        "events": 5000,
        "alerts": 8,
        "alert_rules": 2,
        "engagements": 1,
        "allow_list": 3,
    }
    assert await mongo_store.count_synthetic_records() == sum(counts.values())

    deleted = await _clean(mongo_store, "tester")

    assert deleted["access_points"] == 50
    assert await mongo_store.count_synthetic_records() == 0
    assert await mongo_store.db.access_points.count_documents({"ssid": "Real"}) == 1


@pytest.mark.slow
async def test_seed_demo_refuses_when_real_sensor_recent(mongo_store: MongoStore) -> None:
    """The safety guard refuses seeding while a real sensor is active."""

    await mongo_store.ensure_indexes()
    await mongo_store.db.sensors.insert_one(
        Sensor(
            id="pi-real",
            name="Real Pi",
            tailnet_ip="100.64.0.2",
            last_seen=datetime.now(tz=UTC),
            version="0.1.0",
        ).model_dump(mode="json")
    )
    settings = Settings(
        env="dev",
        cookie_secure=False,
        jwt_secret="t" * 32,
    )

    refusal = await _refusal_reason(settings, mongo_store, force=False)

    assert refusal == "a non-synthetic sensor reported within the last 5 minutes"
    assert await _refusal_reason(settings, mongo_store, force=True) is None


@pytest.mark.slow
async def test_demo_stream_queue_round_trips_through_mongo(mongo_store: MongoStore) -> None:
    """Mongo persists and removes transient demo stream records."""

    await mongo_store.ensure_indexes()
    record = DemoStreamProducer.from_seed_dataset().next_record()

    await mongo_store.enqueue_demo_stream_record(record)
    pending = await mongo_store.pending_demo_stream_records(10)
    await mongo_store.delete_demo_stream_record(record.id)

    assert pending == [record]
    assert await mongo_store.pending_demo_stream_records(10) == []


async def test_seed_demo_refuses_outside_dev() -> None:
    """The environment guard refuses non-dev settings."""

    settings = Settings(
        env="production",
        cookie_secure=False,
        jwt_secret="p" * 32,
        seed_admin_password="changed",
        sensor_gateway_header_secret="x" * 32,
    )

    refusal = await _refusal_reason(settings, None, force=False)  # type: ignore[arg-type]

    assert refusal == "CHEEKY_PONY_ENV must be dev"
    assert await _refusal_reason(settings, None, force=True) is None  # type: ignore[arg-type]


async def test_seed_demo_refuses_while_lab_mode_enabled() -> None:
    """The safety guard refuses when lab mode is live unless forced."""

    settings = Settings(
        env="dev",
        lab_mode=True,
        cookie_secure=False,
        jwt_secret="d" * 32,
    )

    refusal = await _refusal_reason(settings, None, force=False)  # type: ignore[arg-type]

    assert refusal == "CHEEKY_PONY_LAB_MODE must be false"
    assert await _refusal_reason(settings, None, force=True) is None  # type: ignore[arg-type]


def test_demo_dataset_shape_and_safety_markers() -> None:
    now = datetime(2026, 5, 18, 12, tzinfo=UTC)
    dataset = build_demo_dataset(now, with_active=True)

    assert len(dataset.sensors) == 3
    assert len(dataset.access_points) == 50
    assert len(dataset.clients) == 200
    assert len(dataset.events) == EVENT_COUNT
    assert len(dataset.alerts) == 8
    assert len(dataset.alert_rules) == 2
    assert len(dataset.engagements) == 2
    assert len(dataset.allow_list) == 6
    assert len(dataset.audit_logs) == 2
    assert all(sensor.id.startswith("synth-pi-") for sensor in dataset.sensors)
    assert all(ap.bssid.startswith("02:00:") and ap.synthetic for ap in dataset.access_points)
    assert all(len(ap.signal_history) == SIGNAL_HISTORY_CAP for ap in dataset.access_points)
    assert all(client.mac.startswith("02:00:") and client.synthetic for client in dataset.clients)
    assert all(event.synthetic and event.occurred_at <= now for event in dataset.events)
    assert {event.kind for event in dataset.events} == {
        EventKind.ACCESS_POINT_SEEN,
        EventKind.CLIENT_SEEN,
        EventKind.PROBE_REQUEST,
        EventKind.ASSOCIATION,
    }


async def test_demo_stream_emits_synthetic_topics_and_audits() -> None:
    """Stream mode queues synthetic records, audits start and stop, and relays them."""

    queue = FakeDemoStreamQueue()
    store = InMemoryStore()
    summary = await stream_demo_records(
        queue,
        AuditLogger(store),
        DemoStreamOptions(rate_per_minute=600, duration_seconds=0.22, actor_id="tester"),
    )

    assert summary.emitted >= 2
    assert [log.action for log in store.audit_logs] == ["demo.stream.start", "demo.stream.stop"]
    assert store.audit_logs[-1].parameters["emitted"] == summary.emitted
    assert all(record.synthetic and record.payload["synthetic"] is True for record in queue.records)

    broker = OperatorBroker()
    receiver = RecordingWebSocket()
    await broker.connect(receiver)  # type: ignore[arg-type]
    await broker.connect(DroppingWebSocket())  # type: ignore[arg-type]
    relayed = await DemoStreamRelay(queue, broker).flush_once()

    assert relayed == summary.emitted
    assert queue.records == []
    assert len(receiver.messages) == summary.emitted


def test_demo_stream_records_keep_synthetic_mac_prefixes() -> None:
    """Generated AP and client stream topics keep the obvious fake MAC prefix."""

    timestamp = datetime(2026, 5, 19, 12, tzinfo=UTC)
    producer = DemoStreamProducer.from_seed_dataset()
    records = [producer.next_record(timestamp) for _ in range(20)]

    for record in records:
        assert record.payload["synthetic"] is True
        if record.kind == DemoStreamKind.EVENT_APPEND:
            event = Event.model_validate(record.payload)
            assert event.synthetic is True
            assert event.occurred_at <= timestamp
        if record.kind == DemoStreamKind.ACCESS_POINT_UPSERT:
            assert str(record.payload["bssid"]).startswith("02:00:")
        if record.kind == DemoStreamKind.CLIENT_UPSERT:
            assert str(record.payload["mac"]).startswith("02:00:")


async def test_seed_demo_run_dispatches_seed_and_clean(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """The CLI runner dispatches seed and clean operations and closes Mongo."""

    fake_store = FakeMongoStore("mongodb://unused", "unused")
    monkeypatch.setattr(seed_demo, "MongoStore", lambda _dsn, _db: fake_store)
    monkeypatch.setattr(seed_demo, "get_settings", _dev_settings)
    monkeypatch.setattr(seed_demo, "_refusal_reason", _allow_run)
    monkeypatch.setattr(seed_demo, "_seed", _fake_seed)
    monkeypatch.setattr(seed_demo, "_clean", _fake_clean)

    seed_code = await seed_demo.run(
        SeedOptions(clean=False, with_active=True, force=False, actor_id="tester")
    )
    clean_code = await seed_demo.run(
        SeedOptions(clean=True, with_active=False, force=False, actor_id="tester")
    )

    assert seed_code == 0
    assert clean_code == 0
    assert fake_store.client.closed is True
    assert fake_store.seeded is True
    assert fake_store.cleaned is True


async def test_seed_demo_run_dispatches_stream(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """The CLI runner dispatches stream mode through the queue boundary."""

    fake_store = FakeMongoStore("mongodb://unused", "unused")
    fake_queue = FakeDemoStreamQueue()
    monkeypatch.setattr(seed_demo, "MongoStore", lambda _dsn, _db: fake_store)
    monkeypatch.setattr(seed_demo, "get_settings", _dev_settings)
    monkeypatch.setattr(seed_demo, "_refusal_reason", _allow_run)
    monkeypatch.setattr(seed_demo, "demo_stream_queue", lambda _store: fake_queue)
    monkeypatch.setattr(seed_demo, "stream_demo_records", _fake_stream)

    stream_code = await seed_demo.run(
        SeedOptions(stream=True, force=False, actor_id="tester", rate=600, duration=0.1)
    )

    assert stream_code == 0
    assert fake_store.client.closed is True
    assert fake_queue.streamed is True


async def test_seed_demo_run_returns_refusal(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """The CLI runner returns a failing exit code when a guard refuses."""

    fake_store = FakeMongoStore("mongodb://unused", "unused")
    monkeypatch.setattr(seed_demo, "MongoStore", lambda _dsn, _db: fake_store)
    monkeypatch.setattr(seed_demo, "get_settings", _dev_settings)
    monkeypatch.setattr(seed_demo, "_refusal_reason", _deny_run)

    code = await seed_demo.run(
        SeedOptions(clean=False, with_active=False, force=False, actor_id="tester")
    )

    assert code == 1
    assert fake_store.client.closed is True


def test_seed_demo_parse_args() -> None:
    """CLI arguments map onto SeedOptions."""

    options = seed_demo._parse_args(["--clean", "--with-active", "--force", "--actor-id", "me"])
    stream = seed_demo._parse_args(["--stream", "--with-seed", "--rate", "60", "--duration", "2.5"])

    assert options == SeedOptions(clean=True, with_active=True, force=True, actor_id="me")
    assert stream == SeedOptions(stream=True, with_seed=True, rate=60, duration=2.5)
    with pytest.raises(SystemExit):
        seed_demo._parse_args(["--stream", "--rate", "601"])


class FakeClient:
    """Minimal Mongo client stand-in."""

    def __init__(self) -> None:
        self.closed = False

    def close(self) -> None:
        """Record close calls."""

        self.closed = True


class FakeMongoStore:
    """Minimal MongoStore stand-in for CLI dispatch tests."""

    def __init__(self, _dsn: str, _database_name: str) -> None:
        self.client = FakeClient()
        self.seeded = False
        self.cleaned = False

    async def ensure_indexes(self) -> None:
        """No-op index creation."""


class FakeDemoStreamQueue:
    """In-memory demo stream queue for tests."""

    def __init__(self) -> None:
        self.records: list[DemoStreamRecord] = []
        self.streamed = False

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


class RecordingWebSocket:
    """WebSocket stand-in that records JSON messages."""

    def __init__(self) -> None:
        self.messages: list[dict[str, Any]] = []

    async def send_json(self, payload: dict[str, Any]) -> None:
        """Record one JSON payload."""

        self.messages.append(payload)


class DroppingWebSocket:
    """WebSocket stand-in that simulates a disconnected subscriber."""

    async def send_json(self, _payload: dict[str, Any]) -> None:
        """Raise the same exception shape the broker catches for dropped sockets."""

        raise RuntimeError("subscriber dropped")


def _dev_settings() -> Settings:
    return Settings(
        env="dev",
        cookie_secure=False,
        jwt_secret="d" * 32,
    )


async def _allow_run(_settings, _store, _force):  # type: ignore[no-untyped-def]
    return None


async def _deny_run(_settings, _store, _force):  # type: ignore[no-untyped-def]
    return "denied"


async def _fake_seed(store, _options):  # type: ignore[no-untyped-def]
    store.seeded = True
    return {"seeded": 1}


async def _fake_clean(store, _actor_id):  # type: ignore[no-untyped-def]
    store.cleaned = True
    return {"cleaned": 1}


async def _fake_stream(queue, _audit, _options):  # type: ignore[no-untyped-def]
    queue.streamed = True
    return DemoStreamSummary(emitted=1)
