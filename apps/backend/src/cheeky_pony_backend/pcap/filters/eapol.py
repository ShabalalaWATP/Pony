# SPDX-License-Identifier: AGPL-3.0-only
"""EAPOL handshake tshark filter."""

from __future__ import annotations

import base64
import re
from dataclasses import dataclass, field

from cheeky_pony_backend.pcap.findings import EapolHandshake, EapolHandshakesEvidence

_MAC = re.compile(r"^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$")
_PMKID = re.compile(r"^[0-9A-Fa-f:]{16,128}$")


@dataclass
class _HandshakeRows:
    bssid: str
    client_mac: str
    messages: set[int] = field(default_factory=set)
    row_count: int = 0
    pmkid: str | None = None
    raw_bytes: list[str] = field(default_factory=list)


def build_args(*, include_lab_evidence: bool) -> list[str]:
    """Return curated tshark argv for EAPOL handshake metadata."""

    args = [
        "-Y",
        "eapol || wlan.rsn.ie.pmkid",
        "-T",
        "fields",
        "-E",
        "separator=\t",
        "-e",
        "frame.time_epoch",
        "-e",
        "wlan.bssid",
        "-e",
        "wlan.sa",
        "-e",
        "wlan.da",
        "-e",
        "wlan_rsna_eapol.keydes.msgnr",
    ]
    if include_lab_evidence:
        args.extend(["-e", "wlan.rsn.ie.pmkid", "-e", "wlan_rsna_eapol.keydes.data"])
    return args


def parse(output: str) -> EapolHandshakesEvidence:
    """Parse EAPOL field output into grouped handshake metadata."""

    grouped: dict[tuple[str, str], _HandshakeRows] = {}
    for line in output.splitlines():
        row = _parse_line(line)
        if row is None:
            continue
        key = (row.bssid, row.client_mac)
        existing = grouped.setdefault(key, _HandshakeRows(row.bssid, row.client_mac))
        _merge_row(existing, row)
    return EapolHandshakesEvidence(handshakes=[_to_handshake(row) for row in grouped.values()])


def _parse_line(line: str) -> _HandshakeRows | None:
    parts = line.split("\t")
    if len(parts) < 5:
        return None
    bssid = _normalized_mac(parts[1])
    source = _normalized_mac(parts[2])
    destination = _normalized_mac(parts[3])
    if bssid is None or source is None or destination is None:
        return None
    client_mac = destination if source == bssid else source
    row = _HandshakeRows(bssid=bssid, client_mac=client_mac, row_count=1)
    message = _message_number(parts[4])
    if message is not None:
        row.messages.add(message)
    if len(parts) > 5:
        row.pmkid = _pmkid(parts[5])
    if len(parts) > 6:
        raw = _raw_bytes_b64(parts[6])
        if raw is not None:
            row.raw_bytes.append(raw)
    return row


def _merge_row(existing: _HandshakeRows, row: _HandshakeRows) -> None:
    existing.messages.update(row.messages)
    existing.row_count += row.row_count
    existing.pmkid = existing.pmkid or row.pmkid
    existing.raw_bytes.extend(row.raw_bytes[: max(0, 8 - len(existing.raw_bytes))])


def _to_handshake(row: _HandshakeRows) -> EapolHandshake:
    numbers = sorted(row.messages)
    message_count = len(numbers) if numbers else min(row.row_count, 4)
    return EapolHandshake(
        bssid=row.bssid,
        client_mac=row.client_mac,
        complete=set(numbers) == {1, 2, 3, 4} or message_count == 4,
        message_count=message_count,
        message_numbers=numbers,
        pmkid=row.pmkid,
        raw_bytes_b64=row.raw_bytes or None,
    )


def _normalized_mac(value: str) -> str | None:
    lowered = value.strip().lower()
    return lowered if _MAC.fullmatch(lowered) else None


def _message_number(value: str) -> int | None:
    stripped = value.strip()
    if stripped in {"1", "2", "3", "4"}:
        return int(stripped)
    return None


def _pmkid(value: str) -> str | None:
    cleaned = value.strip().lower()
    return cleaned if _PMKID.fullmatch(cleaned) else None


def _raw_bytes_b64(value: str) -> str | None:
    hex_value = value.replace(":", "").replace(" ", "").strip()
    if not hex_value:
        return None
    try:
        raw = bytes.fromhex(hex_value)
    except ValueError:
        return None
    return base64.b64encode(raw[:512]).decode("ascii")
