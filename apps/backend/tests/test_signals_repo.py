# SPDX-License-Identifier: AGPL-3.0-only
"""Signal-history repository boundary tests."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from hypothesis import given
from hypothesis import settings as hypothesis_settings
from hypothesis import strategies as st

from cheeky_pony_backend.infra.in_memory_store import InMemoryStore
from cheeky_pony_backend.infra.mongo_store import MongoStore
from cheeky_pony_backend.infra.signals_repo import SIGNAL_HISTORY_CAP, MongoSignalsRepo
from cheeky_pony_shared import AccessPoint, Client, SignalSample


@given(st.integers(min_value=SIGNAL_HISTORY_CAP + 1, max_value=SIGNAL_HISTORY_CAP + 40))
@hypothesis_settings(max_examples=10)
def test_access_point_signal_history_keeps_most_recent_samples(sample_count: int) -> None:
    """Pushing more than the cap keeps exactly the newest AP samples."""

    samples = asyncio.run(_append_ap_samples(sample_count))

    assert len(samples) == SIGNAL_HISTORY_CAP
    assert [sample.seen_at for sample in samples] == _expected_times(sample_count)


@given(st.integers(min_value=SIGNAL_HISTORY_CAP + 1, max_value=SIGNAL_HISTORY_CAP + 40))
@hypothesis_settings(max_examples=10)
def test_client_signal_history_keeps_most_recent_samples(sample_count: int) -> None:
    """Pushing more than the cap keeps exactly the newest client samples."""

    samples = asyncio.run(_append_client_samples(sample_count))

    assert len(samples) == SIGNAL_HISTORY_CAP
    assert [sample.seen_at for sample in samples] == _expected_times(sample_count)


@pytest.mark.slow
async def test_mongo_signals_repo_caps_samples_round_trip() -> None:
    """Mongo signal appends use atomic capped array updates."""

    mongodb = pytest.importorskip("testcontainers.mongodb")
    container = mongodb.MongoDbContainer("mongo:7.0")
    try:
        container.start()
    except Exception as exc:
        pytest.skip(f"MongoDB testcontainer unavailable: {exc}")

    store = MongoStore(container.get_connection_url(), "signals_repo_test")
    try:
        repo = MongoSignalsRepo(store.db)
        sample_count = SIGNAL_HISTORY_CAP + 17
        for index in range(sample_count):
            await repo.append_ap_sample("02:00:A0:00:00:01", _sample(index))

        samples = await repo.recent_ap_samples("02:00:A0:00:00:01", sample_count)

        assert len(samples) == SIGNAL_HISTORY_CAP
        assert [sample.seen_at for sample in samples] == _expected_times(sample_count)
    finally:
        store.client.close()
        container.stop()


async def _append_ap_samples(sample_count: int) -> list[SignalSample]:
    store = InMemoryStore()
    for index in range(sample_count):
        await store.upsert_access_point(
            AccessPoint(bssid="02:00:A0:00:00:01", signal_history=[_sample(index)])
        )
    access_point = await store.get_access_point("02:00:A0:00:00:01")
    assert access_point is not None
    return access_point.signal_history


async def _append_client_samples(sample_count: int) -> list[SignalSample]:
    store = InMemoryStore()
    for index in range(sample_count):
        await store.upsert_client(Client(mac="02:00:C0:00:00:01", signal_history=[_sample(index)]))
    client = await store.get_client("02:00:C0:00:00:01")
    assert client is not None
    return client.signal_history


def _sample(index: int) -> SignalSample:
    return SignalSample(seen_at=_sample_time(index), rssi_dbm=-60)


def _sample_time(index: int) -> datetime:
    return datetime(2026, 1, 1, tzinfo=UTC) + timedelta(seconds=index)


def _expected_times(sample_count: int) -> list[datetime]:
    start = sample_count - SIGNAL_HISTORY_CAP
    return [_sample_time(index) for index in range(start, sample_count)]
