# SPDX-License-Identifier: AGPL-3.0-only
"""Network-layer PCAP finding evidence models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CountedName(BaseModel):
    """A bounded name/count pair."""

    model_config = ConfigDict(extra="forbid")

    count: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=253)


class CountedRecordType(BaseModel):
    """A DNS record type count."""

    model_config = ConfigDict(extra="forbid")

    count: int = Field(ge=1)
    record_type: str = Field(min_length=1, max_length=16)


class DnsSummaryEvidence(BaseModel):
    """DNS query summary evidence."""

    model_config = ConfigDict(extra="forbid")

    query_types: list[CountedRecordType] = Field(default_factory=list)
    top_queries: list[CountedName] = Field(default_factory=list)
    total_queries: int = Field(default=0, ge=0)
    unusual_tlds: list[CountedName] = Field(default_factory=list)


class TlsSniSummaryEvidence(BaseModel):
    """TLS ClientHello SNI summary evidence."""

    model_config = ConfigDict(extra="forbid")

    top_snis: list[CountedName] = Field(default_factory=list)
    total_snis: int = Field(default=0, ge=0)


class DhcpClientObservation(BaseModel):
    """DHCP client metadata observed in a capture."""

    model_config = ConfigDict(extra="forbid")

    client_mac: str = Field(min_length=1, max_length=32)
    hostname: str | None = Field(default=None, max_length=128)
    requested_options: list[str] = Field(default_factory=list, max_length=64)
    vendor: str | None = Field(default=None, max_length=128)
    vendor_class_id: str | None = Field(default=None, max_length=128)
    vendor_source: Literal["client_record", "oui_table", "unknown"] = "unknown"


class DhcpHostnamesEvidence(BaseModel):
    """DHCP hostname and vendor-class evidence."""

    model_config = ConfigDict(extra="forbid")

    clients: list[DhcpClientObservation] = Field(default_factory=list)
