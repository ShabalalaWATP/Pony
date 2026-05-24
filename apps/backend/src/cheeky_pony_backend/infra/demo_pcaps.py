# SPDX-License-Identifier: AGPL-3.0-only
"""Seed synthetic demo PCAPs through the capture analysis services."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.pcap_models import Pcap, PcapAnalysisClaimStatus, PcapStatus
from cheeky_pony_backend.infra.mongo_store import MongoStore
from cheeky_pony_backend.infra.pcap_analysis_store import MongoPcapAnalysisStore
from cheeky_pony_backend.infra.pcap_store import GridFsPcapStore
from cheeky_pony_backend.pcap.analyzer import PcapAnalyzer
from cheeky_pony_backend.pcap.tshark import TsharkRunner, TsharkRuntime
from cheeky_pony_backend.pcap.validator import validate_pcap_bytes

DEMO_PCAP_ENGAGEMENT_ID = "synth-engagement-ended"
_DEMO_PCAP_DIR = Path(__file__).resolve().parents[3] / "data" / "demo_pcaps"


@dataclass(frozen=True)
class DemoPcapAsset:
    """Deterministic sample capture used by the demo seeder."""

    analysis_id: str
    filename: str
    pcap_id: str

    @property
    def path(self) -> Path:
        """Return the repository-local asset path."""

        return _DEMO_PCAP_DIR / self.filename


DEMO_PCAP_ASSETS = (
    DemoPcapAsset(
        analysis_id="synth-analysis-clean-beacons",
        filename="demo-clean-beacons.pcapng",
        pcap_id="synth-pcap-clean-beacons",
    ),
    DemoPcapAsset(
        analysis_id="synth-analysis-deauth-incident",
        filename="demo-deauth-incident.pcapng",
        pcap_id="synth-pcap-deauth-incident",
    ),
    DemoPcapAsset(
        analysis_id="synth-analysis-public-wifi",
        filename="demo-public-wifi.pcapng",
        pcap_id="synth-pcap-public-wifi",
    ),
)


async def seed_demo_pcaps(
    store: MongoStore,
    settings: Settings,
    actor_id: str,
    runtime: TsharkRunner | None = None,
) -> dict[str, int]:
    """Persist demo PCAPs and run the curated analyzer path."""

    pcaps = GridFsPcapStore(store.db)
    analysis_store = MongoPcapAnalysisStore(store.db)
    await pcaps.ensure_indexes()
    await analysis_store.ensure_indexes()
    analyzer = PcapAnalyzer(
        pcaps,
        analysis_store,
        runtime or TsharkRuntime(settings),
        settings,
        store,
    )
    runs = 0
    for asset in DEMO_PCAP_ASSETS:
        pcap = await _replace_demo_pcap(pcaps, analysis_store, asset, settings, actor_id)
        claim = await pcaps.begin_analysis(pcap.engagement_id, pcap.id)
        if claim.status == PcapAnalysisClaimStatus.CLAIMED and claim.pcap is not None:
            await analyzer.analyze(claim.pcap, actor_id=actor_id, analysis_id=asset.analysis_id)
            runs += 1
    return {"pcaps": len(DEMO_PCAP_ASSETS), "analysis_runs": runs}


async def clean_demo_pcaps(store: MongoStore) -> dict[str, int]:
    """Remove deterministic demo PCAP metadata, bytes, and findings."""

    pcaps = GridFsPcapStore(store.db)
    analysis_store = MongoPcapAnalysisStore(store.db)
    await pcaps.ensure_indexes()
    await analysis_store.ensure_indexes()
    deleted = 0
    for asset in DEMO_PCAP_ASSETS:
        await analysis_store.delete_for_pcap(DEMO_PCAP_ENGAGEMENT_ID, asset.pcap_id)
        if await pcaps.delete_pcap(DEMO_PCAP_ENGAGEMENT_ID, asset.pcap_id) is not None:
            deleted += 1
    return {"pcaps": deleted}


async def _replace_demo_pcap(
    pcaps: GridFsPcapStore,
    analysis_store: MongoPcapAnalysisStore,
    asset: DemoPcapAsset,
    settings: Settings,
    actor_id: str,
) -> Pcap:
    await analysis_store.delete_for_pcap(DEMO_PCAP_ENGAGEMENT_ID, asset.pcap_id)
    await pcaps.delete_pcap(DEMO_PCAP_ENGAGEMENT_ID, asset.pcap_id)
    content = await asyncio.to_thread(asset.path.read_bytes)
    max_bytes = settings.pcap_max_upload_mb * 1024 * 1024
    validated = await validate_pcap_bytes(_chunks(content), max_bytes=max_bytes)
    gridfs_id = await pcaps.write_file(
        asset.filename,
        _chunks(content),
        {"engagement_id": DEMO_PCAP_ENGAGEMENT_ID, "pcap_id": asset.pcap_id, "synthetic": True},
    )
    return await pcaps.create_pcap(
        Pcap(
            id=asset.pcap_id,
            engagement_id=DEMO_PCAP_ENGAGEMENT_ID,
            filename_sanitized=asset.filename,
            size_bytes=validated.size_bytes,
            sha256=validated.sha256,
            magic=validated.magic,
            uploaded_by=actor_id,
            uploaded_at=datetime.now(tz=UTC),
            status=PcapStatus.UPLOADED,
            gridfs_id=gridfs_id,
        )
    )


async def _chunks(content: bytes) -> AsyncIterator[bytes]:
    yield content
