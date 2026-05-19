# SPDX-License-Identifier: AGPL-3.0-only
"""Property-based tests for Kismet normalization."""

from __future__ import annotations

from hypothesis import given
from hypothesis import strategies as st

from cheeky_pony_sensor.normalizers import normalize_kismet_device, normalize_mac
from cheeky_pony_shared import EventKind


@given(st.text())
def test_normalize_mac_never_raises(value: str) -> None:
    """Arbitrary text either normalizes to a MAC or returns None."""

    result = normalize_mac(value)

    assert result is None or result.count(":") == 5


def test_normalize_access_point_event() -> None:
    """Kismet AP JSON is normalized into an access point event."""

    events = normalize_kismet_device(
        {
            "kismet.device.base.macaddr": "aa-bb-cc-dd-ee-ff",
            "kismet.device.base.type": "Wi-Fi AP",
            "dot11.device/dot11.device.last_beaconed_ssid": "Lab",
            "kismet.device.base.channel": 6,
            "kismet.common.signal.last_signal": -42,
        },
        "pi-1",
    )

    assert events[0].kind == EventKind.ACCESS_POINT_SEEN
    assert events[0].payload["bssid"] == "AA:BB:CC:DD:EE:FF"
    assert "synthetic" not in events[0].payload


def test_normalize_client_event() -> None:
    """Kismet client JSON is normalized into a client event."""

    events = normalize_kismet_device(
        {
            "kismet.device.base.macaddr": "11:22:33:44:55:66",
            "kismet.device.base.type": "Wi-Fi Client",
            "dot11.device/dot11.device.last_bssid": "aa:bb:cc:dd:ee:ff",
        },
        "pi-1",
    )

    assert events[0].kind == EventKind.CLIENT_SEEN
    assert events[0].payload["mac"] == "11:22:33:44:55:66"
    assert "synthetic" not in events[0].payload
