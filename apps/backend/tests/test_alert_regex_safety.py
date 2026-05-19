# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for alert regex safety gates."""

from __future__ import annotations

import pytest

from cheeky_pony_backend.domain.alerts import _regex_matches, is_safe_alert_regex


@pytest.mark.parametrize(
    "pattern",
    [
        "^(a+)+$",
        "(a?)+$",
        "(a|aa)+$",
        "(a|a?)+$",
        "(a{1,2})+$",
    ],
)
def test_alert_regex_rejects_repeated_complex_groups(pattern: str) -> None:
    """Repeated complex groups are outside the alert safe subset."""

    assert not is_safe_alert_regex(pattern)
    assert not _regex_matches(pattern, "a" * 64 + "!")


@pytest.mark.parametrize("pattern", ["^Free", "^synth-ap", r"^02:00:[0-9A-F:]+$"])
def test_alert_regex_accepts_existing_simple_predicates(pattern: str) -> None:
    """Simple anchored patterns used by built-in fixtures remain valid."""

    assert is_safe_alert_regex(pattern)
