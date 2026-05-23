# SPDX-License-Identifier: AGPL-3.0-only
"""Beacon analysis tshark filter."""

from __future__ import annotations

from cheeky_pony_backend.pcap.findings import (
    BeaconMismatch,
    BeaconNetwork,
    BeaconsEvidence,
)
from cheeky_pony_shared import AccessPoint


def build_args() -> list[str]:
    """Return curated tshark argv for beacon summaries."""

    return [
        "-Y",
        "wlan.fc.type_subtype == 0x0008",
        "-T",
        "fields",
        "-E",
        "separator=\t",
        "-e",
        "wlan.bssid",
        "-e",
        "wlan.ssid",
        "-e",
        "wlan_radio.channel",
        "-e",
        "wlan.fixed.capabilities",
        "-e",
        "wlan.tag.vendor.data",
        "-e",
        "wlan.fixed.beacon",
    ]


def parse(output: str, known_aps: list[AccessPoint] | None = None) -> BeaconsEvidence:
    """Parse beacon rows and enrich mismatches against known AP records."""

    known = _known_aps(known_aps or [])
    networks: dict[str, BeaconNetwork] = {}
    for line in output.splitlines():
        network = _parse_line(line)
        if network is None:
            continue
        networks[network.bssid] = _with_mismatches(network, known.get(network.bssid))
    return BeaconsEvidence(networks=list(networks.values()))


def _parse_line(line: str) -> BeaconNetwork | None:
    parts = line.split("\t")
    if len(parts) < 6:
        return None
    bssid = _normalized_bssid(parts[0])
    if bssid is None:
        return None
    return BeaconNetwork(
        beacon_interval_tu=_optional_int(parts[5], max_value=65535),
        bssid=bssid,
        capabilities=_split_tokens(parts[3]),
        channel=_optional_int(parts[2], max_value=196),
        ssid=_ssid(parts[1]),
        vendor_ies=_split_tokens(parts[4]),
    )


def _with_mismatches(network: BeaconNetwork, stored: AccessPoint | None) -> BeaconNetwork:
    if stored is None:
        return network
    mismatches = [
        mismatch
        for mismatch in [_channel_mismatch(network, stored), _ssid_mismatch(network, stored)]
        if mismatch is not None
    ]
    return network.model_copy(update={"mismatches": mismatches})


def _channel_mismatch(network: BeaconNetwork, stored: AccessPoint) -> BeaconMismatch | None:
    if network.channel is None or stored.channel is None or network.channel == stored.channel:
        return None
    return BeaconMismatch(
        detail="Beacon advertises a different channel than the stored AP record.",
        field="channel",
        observed=str(network.channel),
        stored=str(stored.channel),
    )


def _ssid_mismatch(network: BeaconNetwork, stored: AccessPoint) -> BeaconMismatch | None:
    if network.ssid is None or stored.ssid is None or network.ssid == stored.ssid:
        return None
    return BeaconMismatch(
        detail="Beacon SSID differs from the stored AP record.",
        field="ssid",
        observed=network.ssid,
        stored=stored.ssid,
    )


def _known_aps(aps: list[AccessPoint]) -> dict[str, AccessPoint]:
    return {ap.bssid.lower(): ap for ap in aps}


def _normalized_bssid(value: str) -> str | None:
    lowered = value.strip().lower()
    return lowered if lowered.count(":") == 5 else None


def _optional_int(value: str, *, max_value: int) -> int | None:
    try:
        parsed = int(value.strip())
    except ValueError:
        return None
    return parsed if 0 < parsed <= max_value else None


def _ssid(value: str) -> str | None:
    cleaned = value.strip()
    return cleaned[:128] if cleaned else None


def _split_tokens(value: str) -> list[str]:
    tokens = [token.strip()[:80] for token in value.replace(",", ";").split(";")]
    return [token for token in tokens if token][:24]
