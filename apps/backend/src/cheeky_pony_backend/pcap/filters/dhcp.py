# SPDX-License-Identifier: AGPL-3.0-only
"""DHCP hostname tshark filter."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

from cheeky_pony_backend.domain.oui_lookup import OuiService
from cheeky_pony_backend.pcap.network_findings import (
    DhcpClientObservation,
    DhcpHostnamesEvidence,
)
from cheeky_pony_shared import Client

_MAC = re.compile(r"^[0-9a-f]{2}(:[0-9a-f]{2}){5}$")


@dataclass
class _DhcpRow:
    mac: str
    hostname: str | None = None
    requested_options: list[str] = field(default_factory=list)
    vendor_class_id: str | None = None


def build_args() -> list[str]:
    """Return curated tshark argv for DHCP client metadata."""

    return [
        "-Y",
        "bootp.option.hostname || bootp.option.vendor_class_id || bootp.option.request_list_item",
        "-T",
        "fields",
        "-E",
        "separator=\t",
        "-e",
        "bootp.hw.mac_addr",
        "-e",
        "bootp.option.hostname",
        "-e",
        "bootp.option.vendor_class_id",
        "-e",
        "bootp.option.request_list_item",
    ]


def parse(output: str, clients: list[Client], oui: OuiService) -> DhcpHostnamesEvidence:
    """Parse DHCP field output and enrich observed clients with known vendors."""

    known_clients = _known_clients(clients)
    grouped: dict[str, _DhcpRow] = {}
    for line in output.splitlines():
        row = _parse_line(line)
        if row is None:
            continue
        existing = grouped.setdefault(row.mac, _DhcpRow(mac=row.mac))
        _merge_row(existing, row)
    observations = [_observation(row, known_clients.get(row.mac), oui) for row in grouped.values()]
    return DhcpHostnamesEvidence(clients=observations)


def _known_clients(clients: list[Client]) -> dict[str, Client]:
    known: dict[str, Client] = {}
    for client in clients:
        mac = _normalize_mac(client.mac)
        if mac is not None:
            known[mac] = client
    return known


def _parse_line(line: str) -> _DhcpRow | None:
    parts = line.split("\t")
    if not parts:
        return None
    mac = _normalize_mac(parts[0])
    if mac is None:
        return None
    return _DhcpRow(
        mac=mac,
        hostname=_bounded_text(parts[1], 128) if len(parts) > 1 else None,
        vendor_class_id=_bounded_text(parts[2], 128) if len(parts) > 2 else None,
        requested_options=_split_options(parts[3]) if len(parts) > 3 else [],
    )


def _merge_row(existing: _DhcpRow, row: _DhcpRow) -> None:
    existing.hostname = existing.hostname or row.hostname
    existing.vendor_class_id = existing.vendor_class_id or row.vendor_class_id
    for option in row.requested_options:
        if option not in existing.requested_options and len(existing.requested_options) < 64:
            existing.requested_options.append(option)


def _observation(row: _DhcpRow, client: Client | None, oui: OuiService) -> DhcpClientObservation:
    vendor = oui.lookup(row.mac)
    source: Literal["client_record", "oui_table", "unknown"]
    if client is not None and client.vendor_oui:
        vendor_name = client.vendor_oui
        source = "client_record"
    elif vendor is not None:
        vendor_name = vendor.long_vendor
        source = "oui_table"
    else:
        vendor_name = None
        source = "unknown"
    return DhcpClientObservation(
        client_mac=row.mac,
        hostname=row.hostname,
        requested_options=row.requested_options,
        vendor=vendor_name,
        vendor_class_id=row.vendor_class_id,
        vendor_source=source,
    )


def _normalize_mac(value: str) -> str | None:
    lowered = value.strip().lower()
    return lowered if _MAC.fullmatch(lowered) else None


def _bounded_text(value: str, max_length: int) -> str | None:
    cleaned = value.strip()
    return cleaned[:max_length] if cleaned else None


def _split_options(value: str) -> list[str]:
    tokens = re.split(r"[,;]", value)
    return [token.strip()[:32] for token in tokens if token.strip()][:64]
