# SPDX-License-Identifier: AGPL-3.0-only
"""Deauthentication burst tshark filter."""

from __future__ import annotations

from collections import defaultdict, deque
from io import StringIO

from cheeky_pony_backend.pcap.findings import DeauthBurst, DeauthBurstsEvidence

_WINDOW_SECONDS = 300
_THRESHOLD = 10
_MAX_PARSED_ROWS = 10_000
_MAX_TIMESTAMPS_PER_BSSID = 2_000


def build_args() -> list[str]:
    """Return curated tshark argv for deauthentication frames."""

    return [
        "-Y",
        "wlan.fc.type_subtype == 0x000c",
        "-T",
        "fields",
        "-E",
        "separator=\t",
        "-e",
        "frame.time_epoch",
        "-e",
        "wlan.sa",
        "-e",
        "wlan.da",
        "-e",
        "wlan.bssid",
    ]


def parse(output: str) -> DeauthBurstsEvidence:
    """Parse deauthentication frame fields and detect bursts."""

    by_bssid: dict[str, list[float]] = defaultdict(list)
    parsed_rows = 0
    for line in StringIO(output):
        parsed = _parse_line(line)
        if parsed is None:
            continue
        parsed_rows += 1
        if parsed_rows > _MAX_PARSED_ROWS:
            break
        timestamp, bssid = parsed
        timestamps = by_bssid[bssid]
        if len(timestamps) < _MAX_TIMESTAMPS_PER_BSSID:
            timestamps.append(timestamp)
    return DeauthBurstsEvidence(
        bursts=_detect_bursts(by_bssid),
        threshold=_THRESHOLD,
        window_seconds=_WINDOW_SECONDS,
    )


def _parse_line(line: str) -> tuple[float, str] | None:
    parts = line.split("\t")
    if len(parts) < 4:
        return None
    try:
        timestamp = float(parts[0])
    except ValueError:
        return None
    bssid = (parts[3] or parts[1] or "unknown").strip().lower()
    return timestamp, bssid[:32]


def _detect_bursts(by_bssid: dict[str, list[float]]) -> list[DeauthBurst]:
    bursts: list[DeauthBurst] = []
    for bssid, timestamps in by_bssid.items():
        window: deque[float] = deque()
        for timestamp in sorted(timestamps):
            window.append(timestamp)
            while window and timestamp - window[0] > _WINDOW_SECONDS:
                window.popleft()
            if len(window) == _THRESHOLD:
                bursts.append(
                    DeauthBurst(
                        bssid=bssid,
                        count=len(window),
                        first_seen_epoch=window[0],
                        last_seen_epoch=window[-1],
                    )
                )
                window.clear()
    return bursts
