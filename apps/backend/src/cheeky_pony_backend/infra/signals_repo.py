# SPDX-License-Identifier: AGPL-3.0-only
"""Signal-history repository seam for AP and client time-series samples."""

from __future__ import annotations

from typing import Any, Literal, Protocol

from motor.motor_asyncio import AsyncIOMotorDatabase

from cheeky_pony_shared import SignalSample

SIGNAL_HISTORY_CAP = 200

CollectionName = Literal["access_points", "clients"]


class SignalsRepo(Protocol):
    """Persistence seam for bounded signal sample histories."""

    async def append_ap_sample(self, bssid: str, sample: SignalSample) -> list[SignalSample]:
        """Append one access point sample and return recent samples."""

    async def append_client_sample(self, mac: str, sample: SignalSample) -> list[SignalSample]:
        """Append one client sample and return recent samples."""

    async def recent_ap_samples(
        self,
        bssid: str,
        limit: int = SIGNAL_HISTORY_CAP,
    ) -> list[SignalSample]:
        """Return recent access point samples in stored order."""

    async def recent_client_samples(
        self,
        mac: str,
        limit: int = SIGNAL_HISTORY_CAP,
    ) -> list[SignalSample]:
        """Return recent client samples in stored order."""


class MongoSignalsRepo:
    """MongoDB signal-history adapter using capped array updates."""

    def __init__(self, db: AsyncIOMotorDatabase[dict[str, Any]]) -> None:
        self._db = db

    async def append_ap_sample(self, bssid: str, sample: SignalSample) -> list[SignalSample]:
        """Append one access point sample and return recent samples."""

        return await self._append("access_points", "bssid", bssid.upper(), sample)

    async def append_client_sample(self, mac: str, sample: SignalSample) -> list[SignalSample]:
        """Append one client sample and return recent samples."""

        return await self._append("clients", "mac", mac.upper(), sample)

    async def recent_ap_samples(
        self,
        bssid: str,
        limit: int = SIGNAL_HISTORY_CAP,
    ) -> list[SignalSample]:
        """Return recent access point samples in stored order."""

        return await self._recent("access_points", "bssid", bssid.upper(), limit)

    async def recent_client_samples(
        self,
        mac: str,
        limit: int = SIGNAL_HISTORY_CAP,
    ) -> list[SignalSample]:
        """Return recent client samples in stored order."""

        return await self._recent("clients", "mac", mac.upper(), limit)

    async def _append(
        self,
        collection_name: CollectionName,
        key: str,
        value: str,
        sample: SignalSample,
    ) -> list[SignalSample]:
        collection = self._db[collection_name]
        await collection.update_one(
            {key: value},
            {
                "$push": {
                    "signal_history": {
                        "$each": [sample.model_dump(mode="json")],
                        "$slice": -SIGNAL_HISTORY_CAP,
                    }
                }
            },
            upsert=True,
        )
        return await self._recent(collection_name, key, value, SIGNAL_HISTORY_CAP)

    async def _recent(
        self,
        collection_name: CollectionName,
        key: str,
        value: str,
        limit: int,
    ) -> list[SignalSample]:
        bounded_limit = max(0, min(limit, SIGNAL_HISTORY_CAP))
        if bounded_limit == 0:
            return []
        data = await self._db[collection_name].find_one(
            {key: value},
            {"_id": False, "signal_history": {"$slice": -bounded_limit}},
        )
        history = data.get("signal_history", []) if data else []
        if not isinstance(history, list):
            return []
        return [SignalSample.model_validate(sample) for sample in history]
