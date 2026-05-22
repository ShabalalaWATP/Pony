# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for local access point anomaly scoring."""

from __future__ import annotations

from hypothesis import given
from hypothesis import strategies as st

from cheeky_pony_backend.domain.anomaly import (
    AnomalyReason,
    find_evil_twin_candidates,
    score_access_point,
)
from cheeky_pony_shared import AccessPoint


def test_score_access_point_reports_expected_reasons_and_clamps() -> None:
    """Combined evidence produces a clamped score with every expected contribution."""

    ap = AccessPoint(
        bssid="AA:BB:CC:00:00:01",
        ssid="AcmeCorp-Guest",
        encryption=["open"],
        vendor_oui="Vendor A",
    )
    peer = AccessPoint(
        bssid="AA:BB:CC:00:00:02",
        ssid="AcmeCorp-Guest",
        encryption=["WPA2"],
        vendor_oui="Vendor B",
    )

    score, contributions = score_access_point(
        ap,
        same_ssid_peers=[peer],
        recent_deauths=11,
    )

    assert score == 100
    assert {contribution.reason for contribution in contributions} == {
        AnomalyReason.WEAK_ENCRYPTION,
        AnomalyReason.RECENT_DEAUTH_BURST,
        AnomalyReason.DUPLICATE_SSID_DIFFERENT_VENDOR,
        AnomalyReason.OPEN_WITH_CORPORATE_NAME,
    }


def test_hidden_ssid_scores_only_when_clients_are_associated() -> None:
    """Hidden SSIDs are notable only when active clients reveal activity."""

    ap = AccessPoint(
        bssid="AA:BB:CC:00:00:03",
        ssid=None,
        encryption=["WPA2"],
        vendor_oui="Vendor A",
    )

    score, contributions = score_access_point(
        ap,
        same_ssid_peers=[],
        recent_deauths=0,
        associated_client_count=1,
    )

    assert score == 15
    assert [contribution.reason for contribution in contributions] == [AnomalyReason.HIDDEN_SSID]


def test_evil_twin_candidate_detection_groups_same_ssid_vendor_mismatch() -> None:
    """Same-SSID APs with a public or corporate label and vendor mismatch are candidates."""

    aps = [
        AccessPoint(
            bssid="AA:BB:CC:00:00:01",
            ssid="AcmeCorp-Guest",
            encryption=["WPA2-Enterprise"],
            vendor_oui="Vendor A",
        ),
        AccessPoint(
            bssid="AA:BB:CC:00:00:02",
            ssid="AcmeCorp-Guest",
            encryption=["WPA2-Enterprise"],
            vendor_oui="Vendor A",
        ),
        AccessPoint(
            bssid="AA:BB:CC:00:00:03",
            ssid="AcmeCorp-Guest",
            encryption=["WPA2-Enterprise"],
            vendor_oui="Vendor B",
        ),
    ]

    candidates = find_evil_twin_candidates(aps)

    assert len(candidates) == 1
    assert candidates[0].ssid == "AcmeCorp-Guest"
    assert candidates[0].candidates == [
        "AA:BB:CC:00:00:01",
        "AA:BB:CC:00:00:02",
        "AA:BB:CC:00:00:03",
    ]
    assert candidates[0].suspicion > 0.0


def test_evil_twin_candidate_detection_ignores_non_matches() -> None:
    """Different SSIDs or single APs do not produce candidates."""

    aps = [
        AccessPoint(
            bssid="AA:BB:CC:00:00:01",
            ssid="AcmeCorp-Guest",
            encryption=["WPA2-Enterprise"],
            vendor_oui="Vendor A",
        ),
        AccessPoint(
            bssid="AA:BB:CC:00:00:02",
            ssid="AcmeCorp-Internal",
            encryption=["WPA2-Enterprise"],
            vendor_oui="Vendor B",
        ),
    ]

    assert find_evil_twin_candidates(aps) == []


@given(
    ssid=st.one_of(st.none(), st.text(min_size=0, max_size=32)),
    encryption=st.lists(st.text(min_size=0, max_size=16), max_size=4),
    recent_deauths=st.integers(min_value=0, max_value=50),
    associated_client_count=st.integers(min_value=0, max_value=20),
)
def test_score_access_point_is_pure_and_bounded(
    ssid: str | None,
    encryption: list[str],
    recent_deauths: int,
    associated_client_count: int,
) -> None:
    """Scoring is deterministic and always remains inside the public range."""

    ap = AccessPoint(
        bssid="AA:BB:CC:00:00:01",
        ssid=ssid,
        encryption=encryption,
        vendor_oui="Vendor A",
    )
    first = score_access_point(
        ap,
        same_ssid_peers=[],
        recent_deauths=recent_deauths,
        associated_client_count=associated_client_count,
    )
    second = score_access_point(
        ap,
        same_ssid_peers=[],
        recent_deauths=recent_deauths,
        associated_client_count=associated_client_count,
    )

    assert first == second
    assert 0 <= first[0] <= 100
    assert all(0 <= contribution.weight <= 100 for contribution in first[1])
