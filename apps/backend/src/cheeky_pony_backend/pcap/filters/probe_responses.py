# SPDX-License-Identifier: AGPL-3.0-only
"""Probe-response anomaly tshark filter."""

from __future__ import annotations

from collections import Counter, defaultdict

from cheeky_pony_backend.pcap.findings import (
    ProbeResponseAnomaliesEvidence,
    ProbeResponseAnomaly,
)

_BEACON_SUBTYPES = {"0x0008", "8", "beacon"}
_PROBE_RESPONSE_SUBTYPES = {"0x0005", "5", "probe_response", "probe-response"}


def build_args() -> list[str]:
    """Return curated tshark argv for beacons and probe responses."""

    return [
        "-Y",
        "wlan.fc.type_subtype == 0x0008 || wlan.fc.type_subtype == 0x0005",
        "-T",
        "fields",
        "-E",
        "separator=\t",
        "-e",
        "wlan.fc.type_subtype",
        "-e",
        "wlan.bssid",
        "-e",
        "wlan.sa",
        "-e",
        "wlan.ssid",
    ]


def parse(output: str) -> ProbeResponseAnomaliesEvidence:
    """Parse beacons/probe responses and detect karma-style responses."""

    beaconed: dict[str, set[str]] = defaultdict(set)
    responses: dict[str, Counter[str]] = defaultdict(Counter)
    for line in output.splitlines():
        parsed = _parse_line(line)
        if parsed is None:
            continue
        subtype, bssid, ssid = parsed
        if subtype in _BEACON_SUBTYPES:
            beaconed[bssid].add(ssid)
        if subtype in _PROBE_RESPONSE_SUBTYPES:
            responses[bssid][ssid] += 1
    return ProbeResponseAnomaliesEvidence(
        anomalies=_anomalies(beaconed, responses),
    )


def _parse_line(line: str) -> tuple[str, str, str] | None:
    parts = line.split("\t")
    if len(parts) < 4:
        return None
    subtype = parts[0].strip().lower()
    bssid = _normalized_bssid(parts[1] or parts[2])
    ssid = parts[3].strip()
    if bssid is None or not ssid:
        return None
    return subtype, bssid, ssid[:128]


def _anomalies(
    beaconed: dict[str, set[str]],
    responses: dict[str, Counter[str]],
) -> list[ProbeResponseAnomaly]:
    anomalies: list[ProbeResponseAnomaly] = []
    for bssid, ssid_counts in responses.items():
        expected = beaconed.get(bssid, set())
        unexpected = sorted(ssid for ssid in ssid_counts if ssid not in expected)
        if not unexpected:
            continue
        anomalies.append(
            ProbeResponseAnomaly(
                anomalous_ssids=unexpected[:16],
                beaconed_ssids=sorted(expected)[:16],
                bssid=bssid,
                response_count=sum(ssid_counts[ssid] for ssid in unexpected),
            )
        )
    return anomalies


def _normalized_bssid(value: str) -> str | None:
    lowered = value.strip().lower()
    return lowered if lowered.count(":") == 5 else None
