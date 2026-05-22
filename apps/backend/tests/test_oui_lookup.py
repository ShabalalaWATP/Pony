# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for OUI vendor lookup domain services."""

from __future__ import annotations

from hypothesis import given
from hypothesis import strategies as st

from cheeky_pony_backend.domain.oui_lookup import create_oui_service, normalize_oui_prefix

SERVICE = create_oui_service()


def test_known_prefixes_resolve_to_expected_vendors() -> None:
    """Bundled OUI table resolves the prefixes the dashboard relies on."""

    samsung = SERVICE.lookup("38:c9:86:00:00:01")
    pi_foundation = SERVICE.lookup("b827eb000002")
    pi_trading = SERVICE.lookup("dc-a6-32-00-00-03")

    assert samsung is not None
    assert samsung.long_vendor == "Samsung Electronics Co., Ltd"
    assert pi_foundation is not None
    assert pi_foundation.long_vendor == "Raspberry Pi Foundation"
    assert pi_trading is not None
    assert pi_trading.long_vendor == "Raspberry Pi Trading Ltd"


def test_unknown_prefix_returns_none() -> None:
    """Unknown OUIs fail closed without inventing a vendor."""

    assert SERVICE.lookup("aa:bb:cc:00:00:01") is None


@given(st.text(max_size=128))
def test_lookup_never_raises_for_untrusted_input(value: str) -> None:
    """Arbitrary path or MAC input resolves or returns None without exceptions."""

    result = SERVICE.lookup(value)
    assert result is None or result.prefix == normalize_oui_prefix(value)
