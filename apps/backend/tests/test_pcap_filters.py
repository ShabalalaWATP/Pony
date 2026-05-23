# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for curated PCAP filter parsers."""

from __future__ import annotations

from hypothesis import given
from hypothesis import strategies as st

from cheeky_pony_backend.pcap.filters import conversations, deauth, protocol_hierarchy


def test_protocol_hierarchy_parser_extracts_rows() -> None:
    """Protocol hierarchy rows are parsed into bounded evidence."""

    evidence = protocol_hierarchy.parse("eth frames:3 bytes:300\n  ip frames:2 bytes:200\n")

    assert evidence.protocols[0].protocol == "eth"
    assert evidence.protocols[1].depth == 1
    assert evidence.protocols[1].frames == 2


def test_conversation_parser_keeps_top_talkers() -> None:
    """Conversation rows are sorted by byte volume."""

    evidence = conversations.parse("aa <-> bb 1 50\ncc <-> dd 2 250\n")

    assert evidence.conversations[0].left == "cc"
    assert evidence.conversations[0].bytes == 250


def test_deauth_parser_detects_bursts() -> None:
    """Ten deauths in five minutes produce one burst."""

    rows = "\n".join(f"{1000 + index}\taa\tff\taa:bb:cc:dd:ee:ff" for index in range(10))

    evidence = deauth.parse(rows)

    assert len(evidence.bursts) == 1
    assert evidence.bursts[0].bssid == "aa:bb:cc:dd:ee:ff"
    assert evidence.bursts[0].count == 10


@given(st.text(max_size=2000))
def test_parsers_never_raise_on_arbitrary_text(payload: str) -> None:
    """Parser fuzz smoke: malformed tshark text is not fatal."""

    protocol_hierarchy.parse(payload)
    conversations.parse(payload)
    deauth.parse(payload)
