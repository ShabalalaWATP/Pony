# SPDX-License-Identifier: AGPL-3.0-only
"""Local anomaly scoring and evil-twin detection for access points."""

from __future__ import annotations

from collections import defaultdict
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

from cheeky_pony_backend.domain.labelling import ApType, classify_ap
from cheeky_pony_shared import AccessPoint

DEAUTH_BURST_THRESHOLD = 10
MAX_ANOMALY_SCORE = 100


class AnomalyReason(StrEnum):
    """Access point anomaly contribution reasons."""

    WEAK_ENCRYPTION = "weak_encryption"
    HIDDEN_SSID = "hidden_ssid"
    RECENT_DEAUTH_BURST = "recent_deauth_burst"
    IE_VENDOR_MISMATCH = "ie_vendor_mismatch"
    DUPLICATE_SSID_DIFFERENT_VENDOR = "duplicate_ssid_different_vendor"
    UNEXPECTED_CORPORATE_MATCH = "unexpected_corporate_match"
    OPEN_WITH_CORPORATE_NAME = "open_with_corporate_name"


class StrictAnomalyBase(BaseModel):
    """Strict base model for anomaly response contracts."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class AnomalyContribution(StrictAnomalyBase):
    """One reason contributing to an access point anomaly score."""

    reason: AnomalyReason
    weight: int = Field(ge=0, le=100)
    detail: str = Field(min_length=1, max_length=256)


class EvilTwinCandidate(StrictAnomalyBase):
    """Same-SSID AP group with vendor mismatch indicators."""

    ssid: str = Field(min_length=1, max_length=128)
    candidates: list[str] = Field(min_length=2)
    suspicion: float = Field(ge=0.0, le=1.0)


def score_access_point(
    ap: AccessPoint,
    *,
    same_ssid_peers: list[AccessPoint],
    recent_deauths: int,
    associated_client_count: int = 0,
) -> tuple[int, list[AnomalyContribution]]:
    """Score one access point using deterministic local evidence.

    Args:
        ap: Access point to score.
        same_ssid_peers: Other access points with the same SSID.
        recent_deauths: Recent deauthentication events associated to the AP.
        associated_client_count: Clients currently associated to the AP.

    Returns:
        Clamped anomaly score and contributing reasons.
    """

    contributions = [
        contribution
        for contribution in (
            _weak_encryption(ap),
            _hidden_ssid(ap, associated_client_count),
            _recent_deauth_burst(recent_deauths),
            _duplicate_ssid_different_vendor(ap, same_ssid_peers),
            _open_with_corporate_name(ap),
        )
        if contribution is not None
    ]
    score = min(MAX_ANOMALY_SCORE, sum(contribution.weight for contribution in contributions))
    return score, contributions


def find_evil_twin_candidates(aps: list[AccessPoint]) -> list[EvilTwinCandidate]:
    """Find same-SSID AP groups whose vendor evidence diverges.

    Args:
        aps: Access point records to compare.

    Returns:
        Deterministic list of candidate AP groups.
    """

    groups = _groups_by_ssid(aps)
    candidates = [
        EvilTwinCandidate(
            ssid=ssid,
            candidates=sorted(ap.bssid for ap in group),
            suspicion=_candidate_suspicion(group),
        )
        for ssid, group in sorted(groups.items())
        if _candidate_group(group)
    ]
    return candidates


def _weak_encryption(ap: AccessPoint) -> AnomalyContribution | None:
    encryption = _normalized_encryption(ap)
    if encryption.intersection({"open", "wep", "wpa", "none"}):
        return AnomalyContribution(
            reason=AnomalyReason.WEAK_ENCRYPTION,
            weight=30,
            detail="AP advertises open, WEP, or WPA-only security.",
        )
    return None


def _hidden_ssid(ap: AccessPoint, associated_client_count: int) -> AnomalyContribution | None:
    if ap.ssid is None and associated_client_count > 0:
        return AnomalyContribution(
            reason=AnomalyReason.HIDDEN_SSID,
            weight=15,
            detail="Hidden SSID has associated clients.",
        )
    return None


def _recent_deauth_burst(recent_deauths: int) -> AnomalyContribution | None:
    if recent_deauths > DEAUTH_BURST_THRESHOLD:
        return AnomalyContribution(
            reason=AnomalyReason.RECENT_DEAUTH_BURST,
            weight=25,
            detail="More than 10 deauthentication events were seen in the last 5 minutes.",
        )
    return None


def _duplicate_ssid_different_vendor(
    ap: AccessPoint,
    same_ssid_peers: list[AccessPoint],
) -> AnomalyContribution | None:
    if ap.ssid is None:
        return None
    vendors = _known_vendors([ap, *same_ssid_peers])
    if len(vendors) > 1:
        return AnomalyContribution(
            reason=AnomalyReason.DUPLICATE_SSID_DIFFERENT_VENDOR,
            weight=35,
            detail="Same SSID appears on access points with different vendor OUIs.",
        )
    return None


def _open_with_corporate_name(ap: AccessPoint) -> AnomalyContribution | None:
    if _is_open(ap) and classify_ap(ap).label == ApType.CORPORATE:
        return AnomalyContribution(
            reason=AnomalyReason.OPEN_WITH_CORPORATE_NAME,
            weight=40,
            detail="Corporate-looking SSID is advertising open authentication.",
        )
    return None


def _candidate_group(group: list[AccessPoint]) -> bool:
    return len(group) >= 2 and _has_vendor_mismatch(group) and _has_public_or_corporate(group)


def _candidate_suspicion(group: list[AccessPoint]) -> float:
    labels = {classify_ap(ap).label for ap in group}
    score = 0.7
    if ApType.PUBLIC in labels:
        score += 0.15
    if ApType.CORPORATE in labels:
        score += 0.1
    return min(1.0, score)


def _groups_by_ssid(aps: list[AccessPoint]) -> dict[str, list[AccessPoint]]:
    groups: dict[str, list[AccessPoint]] = defaultdict(list)
    for ap in aps:
        if ap.ssid is not None:
            groups[ap.ssid].append(ap)
    return groups


def _has_vendor_mismatch(aps: list[AccessPoint]) -> bool:
    return len(_known_vendors(aps)) > 1


def _has_public_or_corporate(aps: list[AccessPoint]) -> bool:
    labels = {classify_ap(ap).label for ap in aps}
    return bool(labels.intersection({ApType.CORPORATE, ApType.PUBLIC}))


def _known_vendors(aps: list[AccessPoint]) -> set[str]:
    return {
        vendor for vendor in (_normalized_vendor(ap.vendor_oui) for ap in aps) if vendor is not None
    }


def _normalized_vendor(vendor: str | None) -> str | None:
    if vendor is None:
        return None
    normalized = vendor.strip().lower()
    return normalized or None


def _normalized_encryption(ap: AccessPoint) -> set[str]:
    return {value.strip().lower() for value in ap.encryption}


def _is_open(ap: AccessPoint) -> bool:
    return bool(_normalized_encryption(ap).intersection({"open", "none"}))
