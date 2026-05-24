# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for LLM prompt redaction."""

from __future__ import annotations

import re

from hypothesis import given
from hypothesis import strategies as st

from cheeky_pony_backend.llm.redactor import PromptRedactor

_MAC_RE = re.compile(
    r"\b(?:[0-9a-f]{2}(?::[0-9a-f]{2}){5}|"
    r"[0-9a-f]{2}(?:-[0-9a-f]{2}){5}|"
    r"[0-9a-f]{12})\b",
    re.IGNORECASE,
)


@given(
    st.sampled_from(
        [
            "AA:BB:CC:DD:EE:FF",
            "AA-BB-CC-DD-EE-FF",
            "AABBCCDDEEFF",
            "02:00:00:00:00:01",
            "38:C9:86:10:20:30",
        ]
    )
)
def test_redactor_replaces_mac_identifiers_stably(mac: str) -> None:
    """Every MAC-shaped identifier is replaced by a stable opaque token."""

    result = PromptRedactor().redact({"bssid": mac, "related_entities": [mac]})

    assert _MAC_RE.search(result.text) is None
    assert "ap-A" in result.replacements.values()
    assert result.text.count("ap-A") == 2


def test_redactor_toggles_ssid_and_vendor_redaction() -> None:
    """SSID and vendor names can be redacted for stricter deployments."""

    result = PromptRedactor(redact_ssid=True, redact_vendor=True).redact(
        {"ssid": "CorpNet", "vendor_oui": "Samsung Electronics"}
    )

    assert "CorpNet" not in result.text
    assert "Samsung" not in result.text
    assert "ssid-A" in result.text
    assert "vendor-A" in result.text


def test_redactor_drops_sensitive_keys() -> None:
    """Secrets and probe payloads are removed before prompt construction."""

    result = PromptRedactor().redact(
        {
            "api_key": "secret-value",
            "probe_payload": "directed-probe",
            "safe": "visible",
        }
    )

    assert "secret-value" not in result.text
    assert "directed-probe" not in result.text
    assert "visible" in result.text
