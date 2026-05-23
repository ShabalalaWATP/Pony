# SPDX-License-Identifier: AGPL-3.0-only
"""TLS SNI summary tshark filter."""

from __future__ import annotations

from collections import Counter

from cheeky_pony_backend.pcap.hostname_redaction import redact_hostname
from cheeky_pony_backend.pcap.network_findings import CountedName, TlsSniSummaryEvidence


def build_args() -> list[str]:
    """Return curated tshark argv for TLS ClientHello SNI summaries."""

    return [
        "-Y",
        "tls.handshake.extensions_server_name",
        "-T",
        "fields",
        "-E",
        "separator=\t",
        "-e",
        "tls.handshake.extensions_server_name",
    ]


def parse(
    output: str,
    internal_suffixes: list[str],
    *,
    top_n: int = 50,
) -> TlsSniSummaryEvidence:
    """Parse TLS SNI field output into a redacted summary."""

    names: Counter[str] = Counter()
    for line in output.splitlines():
        for item in _split_values(line):
            name = redact_hostname(item, internal_suffixes)
            if name is not None:
                names[name] += 1
    return TlsSniSummaryEvidence(top_snis=_names(names, top_n), total_snis=sum(names.values()))


def _split_values(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _names(counter: Counter[str], limit: int) -> list[CountedName]:
    return [
        CountedName(name=name, count=count)
        for name, count in counter.most_common(max(0, min(limit, 100)))
    ]
