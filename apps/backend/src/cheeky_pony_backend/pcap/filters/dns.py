# SPDX-License-Identifier: AGPL-3.0-only
"""DNS summary tshark filter."""

from __future__ import annotations

from collections import Counter

from cheeky_pony_backend.pcap.hostname_redaction import (
    INTERNAL_HOSTNAME_REDACTED,
    redact_hostname,
)
from cheeky_pony_backend.pcap.network_findings import (
    CountedName,
    CountedRecordType,
    DnsSummaryEvidence,
)

_COMMON_TLDS = {
    "biz",
    "co",
    "com",
    "dev",
    "edu",
    "gov",
    "io",
    "me",
    "net",
    "org",
    "uk",
}
_DNS_TYPE_NAMES = {
    "1": "A",
    "2": "NS",
    "5": "CNAME",
    "12": "PTR",
    "15": "MX",
    "16": "TXT",
    "28": "AAAA",
}


def build_args() -> list[str]:
    """Return curated tshark argv for DNS query summaries."""

    return [
        "-Y",
        "dns.flags.response == 0 && dns.qry.name",
        "-T",
        "fields",
        "-E",
        "separator=\t",
        "-e",
        "dns.qry.name",
        "-e",
        "dns.qry.type",
    ]


def parse(
    output: str,
    internal_suffixes: list[str],
    *,
    top_n: int = 50,
) -> DnsSummaryEvidence:
    """Parse DNS query field output into a redacted summary."""

    names: Counter[str] = Counter()
    types: Counter[str] = Counter()
    unusual_tlds: Counter[str] = Counter()
    for line in output.splitlines():
        _merge_line(line, internal_suffixes, names, types, unusual_tlds)
    return DnsSummaryEvidence(
        query_types=_record_types(types, top_n),
        top_queries=_names(names, top_n),
        total_queries=sum(names.values()),
        unusual_tlds=_names(unusual_tlds, top_n),
    )


def _merge_line(
    line: str,
    internal_suffixes: list[str],
    names: Counter[str],
    types: Counter[str],
    unusual_tlds: Counter[str],
) -> None:
    parts = line.split("\t")
    if not parts:
        return
    raw_names = _split_values(parts[0])
    raw_types = _split_values(parts[1]) if len(parts) > 1 else []
    for index, raw_name in enumerate(raw_names):
        name = redact_hostname(raw_name, internal_suffixes)
        if name is None:
            continue
        names[name] += 1
        types[_record_type(raw_types[index] if index < len(raw_types) else "")] += 1
        tld = _unusual_tld(name)
        if tld is not None:
            unusual_tlds[tld] += 1


def _split_values(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _record_type(value: str) -> str:
    cleaned = value.strip().upper()
    return _DNS_TYPE_NAMES.get(cleaned, cleaned or "UNKNOWN")[:16]


def _unusual_tld(name: str) -> str | None:
    if name == INTERNAL_HOSTNAME_REDACTED:
        return None
    parts = name.rsplit(".", maxsplit=1)
    if len(parts) != 2:
        return None
    tld = parts[1]
    return None if tld in _COMMON_TLDS else tld[:253]


def _names(counter: Counter[str], limit: int) -> list[CountedName]:
    return [
        CountedName(name=name, count=count)
        for name, count in counter.most_common(max(0, min(limit, 100)))
    ]


def _record_types(counter: Counter[str], limit: int) -> list[CountedRecordType]:
    return [
        CountedRecordType(record_type=name, count=count)
        for name, count in counter.most_common(max(0, min(limit, 100)))
    ]
