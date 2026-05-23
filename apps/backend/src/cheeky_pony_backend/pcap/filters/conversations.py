# SPDX-License-Identifier: AGPL-3.0-only
"""Conversation tshark filter."""

from __future__ import annotations

import re

from cheeky_pony_backend.pcap.findings import Conversation, ConversationsEvidence

_ARROW_ROW = re.compile(
    r"(?P<left>\S+)\s+<->\s+(?P<right>\S+).*?"
    r"(?P<frames>\d+)\s+(?P<bytes>\d+)(?:\s|$)"
)


def build_args() -> list[str]:
    """Return curated tshark argv for WLAN and IP conversations."""

    return ["-q", "-z", "conv,wlan", "-z", "conv,ip"]


def parse(output: str, top_n: int = 50) -> ConversationsEvidence:
    """Parse tshark conversation tables."""

    rows: list[Conversation] = []
    for line in output.splitlines():
        match = _ARROW_ROW.search(line)
        if match is None:
            continue
        rows.append(
            Conversation(
                bytes=int(match.group("bytes")),
                frames=int(match.group("frames")),
                left=match.group("left")[:128],
                right=match.group("right")[:128],
            )
        )
    rows.sort(key=lambda row: (row.bytes, row.frames), reverse=True)
    return ConversationsEvidence(conversations=rows[:top_n])
