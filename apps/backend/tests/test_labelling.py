# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for local AP and client labelling heuristics."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from hypothesis import given
from hypothesis import strategies as st

from cheeky_pony_backend.domain.labelling import (
    ApType,
    DeviceClass,
    classify_ap,
    classify_client,
    threshold_client_label,
)
from cheeky_pony_shared import AccessPoint, Client


@pytest.mark.parametrize(
    ("ap", "expected"),
    [
        (
            AccessPoint(
                bssid="AA:BB:CC:00:00:01",
                ssid="AcmeCorp-Guest",
                encryption=["WPA2-Enterprise"],
            ),
            ApType.CORPORATE,
        ),
        (
            AccessPoint(bssid="AA:BB:CC:00:00:02", ssid="Starbucks WiFi", encryption=["open"]),
            ApType.PUBLIC,
        ),
        (
            AccessPoint(bssid="AA:BB:CC:00:00:03", ssid="Sam's iPhone", encryption=["WPA2"]),
            ApType.MOBILE_HOTSPOT,
        ),
        (
            AccessPoint(bssid="AA:BB:CC:00:00:04", ssid="Nest-Setup-4B2"),
            ApType.IOT,
        ),
        (
            AccessPoint(bssid="AA:BB:CC:00:00:05", ssid="BTHub6-A2C", encryption=["WPA2"]),
            ApType.PERSONAL,
        ),
        (
            AccessPoint(bssid="AA:BB:CC:00:00:06", ssid=None),
            ApType.UNKNOWN,
        ),
    ],
)
def test_access_point_classifier_table(ap: AccessPoint, expected: ApType) -> None:
    """Representative AP inputs classify into stable labels."""

    result = classify_ap(ap)

    assert result.label == expected
    assert 0.0 <= result.confidence <= 1.0


@pytest.mark.parametrize(
    ("client", "probes", "expected"),
    [
        (
            Client(mac="AA:BB:CC:00:00:01", vendor_oui="Apple, Inc."),
            ["Home", "Work", "Coffee", "Train"],
            DeviceClass.MOBILE,
        ),
        (
            Client(mac="AA:BB:CC:00:00:02", vendor_oui="Intel Corporate"),
            [],
            DeviceClass.LAPTOP,
        ),
        (
            Client(mac="AA:BB:CC:00:00:03", vendor_oui="Espressif Inc."),
            [],
            DeviceClass.IOT,
        ),
        (
            Client(mac="AA:BB:CC:00:00:04", vendor_oui="Fitbit Inc."),
            [],
            DeviceClass.WEARABLE,
        ),
        (
            Client(mac="AA:BB:CC:00:00:05", vendor_oui="Unknown"),
            [],
            DeviceClass.UNKNOWN,
        ),
    ],
)
def test_client_classifier_table(
    client: Client,
    probes: list[str],
    expected: DeviceClass,
) -> None:
    """Representative client inputs classify into stable labels."""

    result = classify_client(client, probes)

    assert result.label == expected
    assert 0.0 <= result.confidence <= 1.0


def test_client_anchor_heuristic_identifies_fixed_iot_device() -> None:
    """A single-AP client with sparse probes over a week is likely fixed equipment."""

    now = datetime(2026, 5, 22, tzinfo=UTC)
    client = Client(
        mac="AA:BB:CC:00:00:06",
        vendor_oui="Unknown",
        associated_bssid="AA:BB:CC:00:00:01",
        first_seen=now - timedelta(days=8),
        last_seen=now,
    )

    assert classify_client(client, []).label == DeviceClass.IOT


def test_threshold_turns_low_confidence_client_label_unknown() -> None:
    """The configured threshold suppresses weak labels before serialization."""

    client = Client(mac="AA:BB:CC:00:00:07", vendor_oui="Apple, Inc.", probes=["Home"])
    weak = classify_client(client, client.probes)
    thresholded = threshold_client_label(weak, 0.6)

    assert weak.label == DeviceClass.MOBILE
    assert thresholded.label == DeviceClass.UNKNOWN
    assert thresholded.confidence == weak.confidence


@given(
    st.one_of(st.none(), st.text(max_size=64)),
    st.lists(st.sampled_from(["open", "WPA2", "WPA2-Enterprise", "WPA3"]), max_size=3),
    st.one_of(st.none(), st.text(max_size=64)),
)
def test_ap_classifier_is_pure_and_bounded(
    ssid: str | None,
    encryption: list[str],
    vendor_oui: str | None,
) -> None:
    """Any valid AP shape produces a deterministic enum label and bounded confidence."""

    ap = AccessPoint(
        bssid="AA:BB:CC:DD:EE:FF",
        ssid=ssid,
        encryption=encryption,
        vendor_oui=vendor_oui,
    )

    first = classify_ap(ap)
    second = classify_ap(ap)

    assert first == second
    assert first.label in set(ApType)
    assert 0.0 <= first.confidence <= 1.0


@given(
    st.one_of(st.none(), st.text(max_size=64)),
    st.lists(st.text(max_size=32), max_size=8),
    st.booleans(),
    st.integers(min_value=0, max_value=30),
)
def test_client_classifier_is_pure_and_bounded(
    vendor_oui: str | None,
    probes: list[str],
    associated: bool,
    observed_days: int,
) -> None:
    """Any valid client shape produces a deterministic enum label and bounded confidence."""

    now = datetime(2026, 5, 22, tzinfo=UTC)
    client = Client(
        mac="AA:BB:CC:DD:EE:FF",
        vendor_oui=vendor_oui,
        associated_bssid="AA:BB:CC:00:00:01" if associated else None,
        probes=probes,
        first_seen=now - timedelta(days=observed_days),
        last_seen=now,
    )

    first = classify_client(client, probes)
    second = classify_client(client, probes)

    assert first == second
    assert first.label in set(DeviceClass)
    assert 0.0 <= first.confidence <= 1.0
