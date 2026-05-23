# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for PCAP byte validation."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from hypothesis import given
from hypothesis import strategies as st

from cheeky_pony_backend.pcap.validator import PcapValidationError, validate_pcap_bytes

PCAP_LE = b"\xd4\xc3\xb2\xa1" + b"\x02\x00\x04\x00" + b"\x00" * 16
PCAP_BE = b"\xa1\xb2\xc3\xd4" + b"\x00\x02\x00\x04" + b"\x00" * 16
PCAPNG = b"\x0a\x0d\x0d\x0a" + b"\x00\x00\x00\x00" + b"\x0c\x00\x00\x00"


async def test_validator_accepts_supported_magic_values() -> None:
    """PCAP little-endian, big-endian, and PCAPNG magic values are accepted."""

    assert (await validate_pcap_bytes(_chunks(PCAP_LE))).magic == "pcap_le"
    assert (await validate_pcap_bytes(_chunks(PCAP_BE))).magic == "pcap_be"
    assert (await validate_pcap_bytes(_chunks(PCAPNG))).magic == "pcapng"


async def test_validator_rejects_unsupported_and_truncated_inputs() -> None:
    """Unsupported, empty, and truncated uploads fail before persistence."""

    for payload, reason in [
        (b"", "empty_file"),
        (b"GIF89a", "unsupported_magic"),
        (b"PK\x03\x04zip", "unsupported_magic"),
        (b"hello", "unsupported_magic"),
        (b"\xd4\xc3\xb2\xa1x", "truncated_file"),
    ]:
        try:
            await validate_pcap_bytes(_chunks(payload))
        except PcapValidationError as exc:
            assert exc.reason == reason
        else:  # pragma: no cover - keeps the assertion message clear
            raise AssertionError(f"{payload!r} unexpectedly validated")


async def test_validator_enforces_size_cap_with_streaming_counter() -> None:
    """The validator accepts 99 MiB and rejects 101 MiB against a 100 MiB cap."""

    mib = 1024 * 1024
    accepted = await validate_pcap_bytes(_sized_pcap(99 * mib), max_bytes=100 * mib)

    assert accepted.size_bytes == 99 * mib
    try:
        await validate_pcap_bytes(_sized_pcap(101 * mib), max_bytes=100 * mib)
    except PcapValidationError as exc:
        assert exc.reason == "size_limit_exceeded"
    else:  # pragma: no cover - keeps the assertion message clear
        raise AssertionError("oversized PCAP unexpectedly validated")


@given(st.binary(max_size=512))
def test_validator_never_throws_untyped_errors(payload: bytes) -> None:
    """Arbitrary bytes either validate or raise the typed validation error."""

    async def run() -> None:
        try:
            await validate_pcap_bytes(_chunks(payload))
        except PcapValidationError:
            return

    asyncio.run(run())


async def _chunks(*chunks: bytes) -> AsyncIterator[bytes]:
    for chunk in chunks:
        yield chunk


async def _sized_pcap(size_bytes: int) -> AsyncIterator[bytes]:
    yield PCAP_LE
    remaining = size_bytes - len(PCAP_LE)
    while remaining > 0:
        chunk_size = min(1024 * 1024, remaining)
        remaining -= chunk_size
        yield b"\x00" * chunk_size
