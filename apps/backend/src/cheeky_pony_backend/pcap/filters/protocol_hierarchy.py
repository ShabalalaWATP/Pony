# SPDX-License-Identifier: AGPL-3.0-only
"""Protocol hierarchy tshark filter."""

from __future__ import annotations

import re

from cheeky_pony_backend.pcap.findings import ProtocolHierarchyEvidence, ProtocolNode

_ROW = re.compile(
    r"^(?P<indent>\s*)(?P<protocol>[A-Za-z0-9_.:-]+)\s+"
    r"frames:(?P<frames>\d+)\s+bytes:(?P<bytes>\d+)"
)


def build_args() -> list[str]:
    """Return curated tshark argv for protocol hierarchy."""

    return ["-q", "-z", "io,phs"]


def parse(output: str) -> ProtocolHierarchyEvidence:
    """Parse tshark protocol hierarchy output."""

    nodes: list[ProtocolNode] = []
    for line in output.splitlines():
        match = _ROW.match(line)
        if match is None:
            continue
        nodes.append(
            ProtocolNode(
                bytes=int(match.group("bytes")),
                depth=len(match.group("indent")) // 2,
                frames=int(match.group("frames")),
                protocol=match.group("protocol")[:80],
            )
        )
    return ProtocolHierarchyEvidence(protocols=nodes)
