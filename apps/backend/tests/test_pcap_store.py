# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for PCAP persistence adapters."""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime

import pytest

from cheeky_pony_backend.domain.pcap_models import Pcap, PcapStatus
from cheeky_pony_backend.infra.pcap_store import GridFsPcapStore

PCAP_BYTES = b"\xd4\xc3\xb2\xa1" + b"\x02\x00\x04\x00" + b"\x00" * 16


@pytest.mark.asyncio
async def test_gridfs_pcap_store_round_trips_metadata_and_bytes() -> None:
    """GridFS-backed storage persists capture bytes and scoped metadata."""

    mongodb = pytest.importorskip("testcontainers.mongodb")
    container = mongodb.MongoDbContainer("mongo:7.0")
    try:
        container.start()
    except Exception as exc:  # pragma: no cover - depends on local Docker availability
        pytest.skip(f"MongoDB testcontainer unavailable: {exc}")
    try:
        client = _mongo_client(container.get_connection_url())
        db = client.pcap_store_test
        store = GridFsPcapStore(db)
        await store.ensure_indexes()
        gridfs_id = await store.write_file("capture.pcap", _chunks(PCAP_BYTES), {"pcap_id": "p1"})
        pcap = await store.create_pcap(_pcap(gridfs_id))

        listed, total = await store.list_pcaps("eng-1", 10, 0)
        loaded = await store.get_pcap("eng-1", "pcap-1")
        content = await _collect(store.read_file(gridfs_id))
        deleted = await store.delete_pcap("eng-1", "pcap-1")

        assert pcap.gridfs_id == gridfs_id
        assert total == 1
        assert listed == [pcap]
        assert loaded == pcap
        assert content == PCAP_BYTES
        assert deleted == pcap
        assert await store.get_pcap("eng-1", "pcap-1") is None
    finally:
        container.stop()


def _mongo_client(dsn: str):
    from motor.motor_asyncio import AsyncIOMotorClient

    return AsyncIOMotorClient(dsn)


def _pcap(gridfs_id: str) -> Pcap:
    return Pcap(
        id="pcap-1",
        engagement_id="eng-1",
        filename_sanitized="capture.pcap",
        size_bytes=len(PCAP_BYTES),
        sha256="0" * 64,
        magic="pcap_le",
        uploaded_by="admin",
        uploaded_at=datetime(2026, 1, 1, tzinfo=UTC),
        status=PcapStatus.UPLOADED,
        gridfs_id=gridfs_id,
    )


async def _chunks(content: bytes) -> AsyncIterator[bytes]:
    yield content


async def _collect(chunks: AsyncIterator[bytes]) -> bytes:
    return b"".join([chunk async for chunk in chunks])
