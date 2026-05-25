# SPDX-License-Identifier: AGPL-3.0-only
"""Synthetic telemetry marker detection for sensor WebSocket input."""

from __future__ import annotations

from pydantic import TypeAdapter, ValidationError

_BOOL_ADAPTER = TypeAdapter(bool)
_SYNTHETIC_SCAN_MAX_DEPTH = 32
_SYNTHETIC_SCAN_MAX_NODES = 1_000


def has_synthetic_marker(value: object) -> bool:
    """Return true when a payload contains a true-like synthetic marker."""

    stack: list[tuple[object, int]] = [(value, 0)]
    visited = 0
    while stack and visited < _SYNTHETIC_SCAN_MAX_NODES:
        item, depth = stack.pop()
        visited += 1
        if isinstance(item, dict):
            marker = item.get("synthetic")
            if marker is not None and _coerces_to_true(marker):
                return True
            if depth < _SYNTHETIC_SCAN_MAX_DEPTH:
                stack.extend((child, depth + 1) for child in item.values())
        elif isinstance(item, list) and depth < _SYNTHETIC_SCAN_MAX_DEPTH:
            stack.extend((child, depth + 1) for child in item)
    return False


def _coerces_to_true(value: object) -> bool:
    try:
        return _BOOL_ADAPTER.validate_python(value) is True
    except ValidationError:
        return False
