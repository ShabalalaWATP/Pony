# SPDX-License-Identifier: AGPL-3.0-only
"""Streaming PCAP magic, size, and digest validation."""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from hashlib import sha256
from typing import Literal

PCAP_LE_MAGIC = b"\xd4\xc3\xb2\xa1"
PCAP_BE_MAGIC = b"\xa1\xb2\xc3\xd4"
PCAPNG_MAGIC = b"\x0a\x0d\x0d\x0a"
DEFAULT_MAX_BYTES = 100 * 1024 * 1024
_MIN_PCAP_BYTES = 24
_MIN_PCAPNG_BYTES = 12

PcapMagic = Literal["pcap_le", "pcap_be", "pcapng"]


@dataclass(frozen=True)
class ValidatedPcap:
    """Validated PCAP metadata derived from bytes."""

    magic: PcapMagic
    sha256: str
    size_bytes: int


class PcapValidationError(Exception):
    """Raised when uploaded bytes are not an accepted capture file."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


async def validate_pcap_bytes(
    reader: AsyncIterator[bytes],
    max_bytes: int = DEFAULT_MAX_BYTES,
) -> ValidatedPcap:
    """Validate PCAP bytes while streaming through the input once.

    Args:
        reader: Async byte chunks from the upload source.
        max_bytes: Maximum accepted size in bytes.

    Returns:
        Validated capture metadata.

    Raises:
        PcapValidationError: If magic, minimum length, or size limit fails.
    """

    digest = sha256()
    size = 0
    prefix = b""
    magic: PcapMagic | None = None
    async for chunk in reader:
        if not chunk:
            continue
        size += len(chunk)
        if size > max_bytes:
            raise PcapValidationError("size_limit_exceeded")
        digest.update(chunk)
        prefix = (prefix + chunk)[:4]
        magic = magic or _magic_from_prefix(prefix)
    if magic is None:
        raise PcapValidationError("empty_file")
    _validate_minimum_size(magic, size)
    return ValidatedPcap(magic=magic, sha256=digest.hexdigest(), size_bytes=size)


def _magic_from_prefix(prefix: bytes) -> PcapMagic | None:
    if len(prefix) < 4:
        return None
    if prefix == PCAP_LE_MAGIC:
        return "pcap_le"
    if prefix == PCAP_BE_MAGIC:
        return "pcap_be"
    if prefix == PCAPNG_MAGIC:
        return "pcapng"
    raise PcapValidationError("unsupported_magic")


def _validate_minimum_size(magic: PcapMagic, size: int) -> None:
    minimum = _MIN_PCAPNG_BYTES if magic == "pcapng" else _MIN_PCAP_BYTES
    if size < minimum:
        raise PcapValidationError("truncated_file")
