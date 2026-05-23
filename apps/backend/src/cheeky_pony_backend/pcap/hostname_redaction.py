# SPDX-License-Identifier: AGPL-3.0-only
"""Hostname normalization and redaction helpers for PCAP findings."""

from __future__ import annotations

INTERNAL_HOSTNAME_REDACTED = "INTERNAL_HOSTNAME_REDACTED"


def normalize_hostname(value: str) -> str | None:
    """Normalize one hostname from untrusted parser output."""

    cleaned = value.strip().strip(".").lower()
    if not cleaned or len(cleaned) > 253:
        return None
    labels = cleaned.split(".")
    if any(not label for label in labels):
        return None
    return cleaned


def normalize_internal_suffixes(values: list[str]) -> list[str]:
    """Normalize configured internal hostname suffixes."""

    suffixes: list[str] = []
    for value in values:
        cleaned = value.strip().strip(".").lower()
        if cleaned:
            suffixes.append(f".{cleaned}")
    return sorted(set(suffixes))


def redact_hostname(value: str, internal_suffixes: list[str]) -> str | None:
    """Return a normalized hostname or the internal-hostname redaction bucket."""

    hostname = normalize_hostname(value)
    if hostname is None:
        return None
    if _is_internal(hostname, normalize_internal_suffixes(internal_suffixes)):
        return INTERNAL_HOSTNAME_REDACTED
    return hostname


def _is_internal(hostname: str, suffixes: list[str]) -> bool:
    return any(hostname == suffix[1:] or hostname.endswith(suffix) for suffix in suffixes)
