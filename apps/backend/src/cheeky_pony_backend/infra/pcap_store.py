# SPDX-License-Identifier: AGPL-3.0-only
"""PCAP metadata and byte persistence adapters."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase, AsyncIOMotorGridFSBucket
from pymongo import ReturnDocument

from cheeky_pony_backend.domain.pcap_models import (
    Pcap,
    PcapAnalysisClaim,
    PcapAnalysisClaimStatus,
    PcapStatus,
)

_READ_CHUNK_BYTES = 1024 * 1024


class PcapStore(Protocol):
    """Persistence boundary for uploaded capture metadata and bytes."""

    async def ensure_indexes(self) -> None:
        """Create backing indexes."""

    async def write_file(
        self,
        filename: str,
        chunks: AsyncIterator[bytes],
        metadata: dict[str, object],
    ) -> str:
        """Persist a capture byte stream and return an opaque file id."""

    def read_file(self, gridfs_id: str) -> AsyncIterator[bytes]:
        """Stream a persisted capture file."""

    async def create_pcap(self, pcap: Pcap) -> Pcap:
        """Persist capture metadata."""

    async def list_pcaps(
        self, engagement_id: str, limit: int, offset: int
    ) -> tuple[list[Pcap], int]:
        """List capture metadata for one engagement."""

    async def get_pcap(self, engagement_id: str, pcap_id: str) -> Pcap | None:
        """Return capture metadata scoped to one engagement."""

    async def begin_analysis(self, engagement_id: str, pcap_id: str) -> PcapAnalysisClaim:
        """Atomically mark a PCAP as analyzing when it is not already busy."""

    async def update_pcap_status(
        self,
        engagement_id: str,
        pcap_id: str,
        status: PcapStatus,
    ) -> Pcap | None:
        """Persist a PCAP lifecycle status."""

    async def delete_pcap(self, engagement_id: str, pcap_id: str) -> Pcap | None:
        """Delete capture metadata and bytes, returning deleted metadata."""

    async def delete_file(self, gridfs_id: str) -> None:
        """Delete a persisted capture byte stream."""


class InMemoryPcapStore:
    """In-memory PCAP store for tests and local no-database execution."""

    def __init__(self) -> None:
        self.pcaps: dict[str, Pcap] = {}
        self.files: dict[str, bytes] = {}
        self._next_file_id = 0

    async def ensure_indexes(self) -> None:
        """No-op for in-memory storage."""

    async def write_file(
        self,
        filename: str,
        chunks: AsyncIterator[bytes],
        metadata: dict[str, object],
    ) -> str:
        """Persist bytes in memory."""

        del filename, metadata
        file_id = f"memory-gridfs-{self._next_file_id}"
        self._next_file_id += 1
        content = bytearray()
        async for chunk in chunks:
            content.extend(chunk)
        self.files[file_id] = bytes(content)
        return file_id

    async def read_file(self, gridfs_id: str) -> AsyncIterator[bytes]:
        """Stream bytes from memory."""

        yield self.files[gridfs_id]

    async def create_pcap(self, pcap: Pcap) -> Pcap:
        """Persist metadata in memory."""

        self.pcaps[pcap.id] = pcap
        return pcap

    async def list_pcaps(
        self, engagement_id: str, limit: int, offset: int
    ) -> tuple[list[Pcap], int]:
        """List engagement-scoped metadata."""

        values = sorted(
            [pcap for pcap in self.pcaps.values() if pcap.engagement_id == engagement_id],
            key=lambda pcap: pcap.uploaded_at,
            reverse=True,
        )
        return values[offset : offset + limit], len(values)

    async def get_pcap(self, engagement_id: str, pcap_id: str) -> Pcap | None:
        """Return metadata when it belongs to the requested engagement."""

        pcap = self.pcaps.get(pcap_id)
        if pcap is None or pcap.engagement_id != engagement_id:
            return None
        return pcap

    async def begin_analysis(self, engagement_id: str, pcap_id: str) -> PcapAnalysisClaim:
        """Mark an in-memory PCAP as analyzing when available."""

        pcap = await self.get_pcap(engagement_id, pcap_id)
        if pcap is None:
            return PcapAnalysisClaim(status=PcapAnalysisClaimStatus.NOT_FOUND)
        if pcap.status == PcapStatus.ANALYZING:
            return PcapAnalysisClaim(status=PcapAnalysisClaimStatus.BUSY, pcap=pcap)
        updated = pcap.model_copy(update={"status": PcapStatus.ANALYZING})
        self.pcaps[pcap_id] = updated
        return PcapAnalysisClaim(status=PcapAnalysisClaimStatus.CLAIMED, pcap=updated)

    async def update_pcap_status(
        self,
        engagement_id: str,
        pcap_id: str,
        status: PcapStatus,
    ) -> Pcap | None:
        """Update an in-memory PCAP status."""

        pcap = await self.get_pcap(engagement_id, pcap_id)
        if pcap is None:
            return None
        updated = pcap.model_copy(update={"status": status})
        self.pcaps[pcap_id] = updated
        return updated

    async def delete_pcap(self, engagement_id: str, pcap_id: str) -> Pcap | None:
        """Delete metadata and bytes from memory."""

        pcap = await self.get_pcap(engagement_id, pcap_id)
        if pcap is None:
            return None
        self.pcaps.pop(pcap_id, None)
        await self.delete_file(pcap.gridfs_id)
        return pcap

    async def delete_file(self, gridfs_id: str) -> None:
        """Delete bytes from memory."""

        self.files.pop(gridfs_id, None)


class GridFsPcapStore:
    """Mongo GridFS-backed PCAP store."""

    def __init__(self, db: AsyncIOMotorDatabase[dict[str, object]]) -> None:
        self._db = db
        self._bucket = AsyncIOMotorGridFSBucket(db, bucket_name="pcap_files")

    async def ensure_indexes(self) -> None:
        """Create Mongo indexes for PCAP metadata."""

        await self._db.pcaps.create_index([("engagement_id", 1), ("id", 1)], unique=True)
        await self._db.pcaps.create_index([("engagement_id", 1), ("uploaded_at", -1)])

    async def write_file(
        self,
        filename: str,
        chunks: AsyncIterator[bytes],
        metadata: dict[str, object],
    ) -> str:
        """Persist bytes to GridFS."""

        grid_in = self._bucket.open_upload_stream(filename, metadata=metadata)
        try:
            async for chunk in chunks:
                await grid_in.write(chunk)
            await grid_in.close()
        except Exception:
            await grid_in.abort()
            raise
        return str(grid_in._id)

    async def read_file(self, gridfs_id: str) -> AsyncIterator[bytes]:
        """Stream bytes from GridFS."""

        grid_out = await self._bucket.open_download_stream(ObjectId(gridfs_id))
        while True:
            chunk: bytes = await grid_out.read(_READ_CHUNK_BYTES)
            if not chunk:
                return
            yield chunk

    async def create_pcap(self, pcap: Pcap) -> Pcap:
        """Persist PCAP metadata."""

        await self._db.pcaps.insert_one(pcap.model_dump(mode="json"))
        return pcap

    async def list_pcaps(
        self, engagement_id: str, limit: int, offset: int
    ) -> tuple[list[Pcap], int]:
        """List PCAP metadata for an engagement."""

        query = {"engagement_id": engagement_id}
        total = await self._db.pcaps.count_documents(query)
        docs = self._db.pcaps.find(query, {"_id": False}).sort("uploaded_at", -1)
        docs = docs.skip(offset).limit(limit)
        return [Pcap.model_validate(doc) async for doc in docs], total

    async def get_pcap(self, engagement_id: str, pcap_id: str) -> Pcap | None:
        """Return PCAP metadata scoped to one engagement."""

        data = await self._db.pcaps.find_one(
            {"engagement_id": engagement_id, "id": pcap_id},
            {"_id": False},
        )
        return Pcap.model_validate(data) if data else None

    async def begin_analysis(self, engagement_id: str, pcap_id: str) -> PcapAnalysisClaim:
        """Atomically mark a Mongo PCAP as analyzing."""

        data = await self._db.pcaps.find_one_and_update(
            {
                "engagement_id": engagement_id,
                "id": pcap_id,
                "status": {"$ne": PcapStatus.ANALYZING.value},
            },
            {"$set": {"status": PcapStatus.ANALYZING.value}},
            projection={"_id": False},
            return_document=ReturnDocument.AFTER,
        )
        if data is not None:
            return PcapAnalysisClaim(
                status=PcapAnalysisClaimStatus.CLAIMED,
                pcap=Pcap.model_validate(data),
            )
        existing = await self.get_pcap(engagement_id, pcap_id)
        if existing is None:
            return PcapAnalysisClaim(status=PcapAnalysisClaimStatus.NOT_FOUND)
        return PcapAnalysisClaim(status=PcapAnalysisClaimStatus.BUSY, pcap=existing)

    async def update_pcap_status(
        self,
        engagement_id: str,
        pcap_id: str,
        status: PcapStatus,
    ) -> Pcap | None:
        """Persist a Mongo PCAP status."""

        data = await self._db.pcaps.find_one_and_update(
            {"engagement_id": engagement_id, "id": pcap_id},
            {"$set": {"status": status.value}},
            projection={"_id": False},
            return_document=ReturnDocument.AFTER,
        )
        return Pcap.model_validate(data) if data else None

    async def delete_pcap(self, engagement_id: str, pcap_id: str) -> Pcap | None:
        """Delete PCAP metadata and its GridFS file."""

        pcap = await self.get_pcap(engagement_id, pcap_id)
        if pcap is None:
            return None
        await self._db.pcaps.delete_one({"engagement_id": engagement_id, "id": pcap_id})
        await self.delete_file(pcap.gridfs_id)
        return pcap

    async def delete_file(self, gridfs_id: str) -> None:
        """Delete a GridFS file by id."""

        await self._bucket.delete(ObjectId(gridfs_id))
