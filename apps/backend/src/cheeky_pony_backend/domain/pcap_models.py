# SPDX-License-Identifier: AGPL-3.0-only
"""PCAP ingest domain models."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PcapStatus(StrEnum):
    """Lifecycle states for an uploaded capture."""

    UPLOADED = "uploaded"
    ANALYZING = "analyzing"
    ANALYZED = "analyzed"
    FAILED = "failed"


class Pcap(BaseModel):
    """Persisted PCAP metadata."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=128)
    engagement_id: str = Field(min_length=1, max_length=128)
    filename_sanitized: str = Field(min_length=1, max_length=128)
    size_bytes: int = Field(ge=0)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    magic: Literal["pcap_le", "pcap_be", "pcapng"]
    uploaded_by: str = Field(min_length=1, max_length=128)
    uploaded_at: datetime
    status: PcapStatus
    gridfs_id: str = Field(min_length=1, max_length=128)
