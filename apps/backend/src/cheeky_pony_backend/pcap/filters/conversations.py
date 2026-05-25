# SPDX-License-Identifier: AGPL-3.0-only
"""Conversation tshark filter."""

from __future__ import annotations

import re
from heapq import heappush, heapreplace
from io import StringIO

from cheeky_pony_backend.pcap.findings import Conversation, ConversationsEvidence

_ARROW_ROW = re.compile(
    r"(?P<left>\S+)\s+<->\s+(?P<right>\S+).*?"
    r"(?P<frames>\d+)\s+(?P<bytes>\d+)(?:\s|$)"
)
_MAX_PARSED_ROWS = 10_000

type _RankedConversation = tuple[int, int, int, Conversation]


def build_args() -> list[str]:
    """Return curated tshark argv for WLAN and IP conversations."""

    return ["-q", "-z", "conv,wlan", "-z", "conv,ip"]


def parse(output: str, top_n: int = 50) -> ConversationsEvidence:
    """Parse tshark conversation tables."""

    rows: list[_RankedConversation] = []
    parsed_rows = 0
    for line in StringIO(output):
        match = _ARROW_ROW.search(line)
        if match is None:
            continue
        parsed_rows += 1
        if parsed_rows > _MAX_PARSED_ROWS:
            break
        _keep_top(rows, _conversation(match), parsed_rows, top_n)
    conversations = [item[3] for item in sorted(rows, reverse=True)]
    return ConversationsEvidence(conversations=conversations)


def _conversation(match: re.Match[str]) -> Conversation:
    return Conversation(
        bytes=int(match.group("bytes")),
        frames=int(match.group("frames")),
        left=match.group("left")[:128],
        right=match.group("right")[:128],
    )


def _keep_top(
    rows: list[_RankedConversation],
    conversation: Conversation,
    sequence: int,
    top_n: int,
) -> None:
    if top_n <= 0:
        return
    ranked = (conversation.bytes, conversation.frames, sequence, conversation)
    if len(rows) < top_n:
        heappush(rows, ranked)
    elif ranked > rows[0]:
        heapreplace(rows, ranked)
