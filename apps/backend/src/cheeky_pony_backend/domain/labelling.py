# SPDX-License-Identifier: AGPL-3.0-only
"""Local AP and client classification heuristics."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import timedelta
from enum import StrEnum

from cheeky_pony_shared import AccessPoint, Client

MOBILE_PROBE_MINIMUM = 3
LAPTOP_PROBE_MINIMUM = 3
IOT_PROBE_MAXIMUM = 1
IOT_ANCHOR_DAYS = 7

HIGH_CONFIDENCE = 0.9
MEDIUM_CONFIDENCE = 0.75
LOW_CONFIDENCE = 0.55
NO_CONFIDENCE = 0.0

PUBLIC_SSIDS = frozenset(
    {
        "_the cloud",
        "bt-wifi",
        "btwi-fi",
        "costa free wifi",
        "ee wifi",
        "hotelguest",
        "o2 wifi",
        "starbucks wifi",
        "train_wifi",
    }
)
MOBILE_VENDOR_MARKERS = frozenset({"apple", "samsung", "google", "huawei", "oneplus", "xiaomi"})
LAPTOP_VENDOR_MARKERS = frozenset({"dell", "hp inc", "intel", "lenovo", "microsoft"})
IOT_VENDOR_MARKERS = frozenset(
    {"amazon technologies", "espressif", "nest", "raspberry pi", "shenzhen bilian", "sonos", "tuya"}
)
WEARABLE_VENDOR_MARKERS = frozenset({"fitbit", "garmin", "withings"})

CORPORATE_PATTERN = re.compile(r"(^.+-(guest|internal)$)|(^.+vpn$)|(^.+staff$)")
IOT_SSID_PATTERN = re.compile(r"(cctv|iot|nest-|ring-|sonos|smartmeter|printer|print|epson|canon)")
MOBILE_HOTSPOT_PATTERN = re.compile(
    r"(^.+['’]s (iphone|galaxy|pixel|phone)$)|(^.*(iphone|galaxy|pixel|oneplus).*$)"
)
PERSONAL_SSID_PATTERN = re.compile(
    r"^(bthub\d|ee-hub|hyperoptic|netgear|nowtv|plusnetwireless|"
    r"sky_|talktalk-|tp-link|vodafoneconnect|vm\d)"
)
PUBLIC_SSID_PATTERN = re.compile(r"^_?[a-z0-9 ]+(wifi|wi-fi|wireless)$")


class ApType(StrEnum):
    """Access point presentation labels."""

    CORPORATE = "corporate"
    PUBLIC = "public"
    MOBILE_HOTSPOT = "mobile_hotspot"
    IOT = "iot"
    PERSONAL = "personal"
    UNKNOWN = "unknown"


class DeviceClass(StrEnum):
    """Client presentation labels."""

    MOBILE = "mobile"
    LAPTOP = "laptop"
    IOT = "iot"
    WEARABLE = "wearable"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class ApClassification:
    """Access point label and confidence."""

    label: ApType
    confidence: float


@dataclass(frozen=True)
class ClientClassification:
    """Client label and confidence."""

    label: DeviceClass
    confidence: float


def classify_ap(ap: AccessPoint) -> ApClassification:
    """Classify an access point using deterministic local metadata.

    Args:
        ap: Access point record.

    Returns:
        Derived access point label and confidence.
    """

    for rule in (_corporate_ap, _mobile_hotspot_ap, _public_ap, _iot_ap, _personal_ap):
        classification = rule(ap)
        if classification is not None:
            return classification
    return ApClassification(ApType.UNKNOWN, NO_CONFIDENCE)


def classify_client(client: Client, probe_history: list[str]) -> ClientClassification:
    """Classify a client device using vendor, probes, and association behavior.

    Args:
        client: Client record.
        probe_history: Probe SSIDs observed for the client.

    Returns:
        Derived client label and confidence.
    """

    for rule in (_wearable_client, _mobile_client, _laptop_client, _iot_client):
        classification = rule(client, probe_history)
        if classification is not None:
            return classification
    return ClientClassification(DeviceClass.UNKNOWN, NO_CONFIDENCE)


def threshold_ap_label(
    classification: ApClassification,
    minimum_confidence: float,
) -> ApClassification:
    """Suppress weak AP classifications.

    Args:
        classification: Raw classifier result.
        minimum_confidence: Minimum confidence required for a non-unknown label.

    Returns:
        Original classification or an unknown label carrying the same confidence.
    """

    if classification.confidence < minimum_confidence:
        return ApClassification(ApType.UNKNOWN, classification.confidence)
    return classification


def threshold_client_label(
    classification: ClientClassification,
    minimum_confidence: float,
) -> ClientClassification:
    """Suppress weak client classifications.

    Args:
        classification: Raw classifier result.
        minimum_confidence: Minimum confidence required for a non-unknown label.

    Returns:
        Original classification or an unknown label carrying the same confidence.
    """

    if classification.confidence < minimum_confidence:
        return ClientClassification(DeviceClass.UNKNOWN, classification.confidence)
    return classification


def _corporate_ap(ap: AccessPoint) -> ApClassification | None:
    """Enterprise encryption or managed SSID names usually indicate corporate networks."""

    ssid = _normalized_ssid(ap)
    if "wpa2-enterprise" in _normalized_encryption(ap):
        return ApClassification(ApType.CORPORATE, HIGH_CONFIDENCE)
    if ssid is not None and CORPORATE_PATTERN.search(ssid):
        return ApClassification(ApType.CORPORATE, MEDIUM_CONFIDENCE)
    return None


def _mobile_hotspot_ap(ap: AccessPoint) -> ApClassification | None:
    """Phone model names and possessive phone SSIDs are typical mobile hotspots."""

    ssid = _normalized_ssid(ap)
    if ssid is not None and MOBILE_HOTSPOT_PATTERN.search(ssid):
        return ApClassification(ApType.MOBILE_HOTSPOT, HIGH_CONFIDENCE)
    return None


def _public_ap(ap: AccessPoint) -> ApClassification | None:
    """Known venue SSIDs or open Wi-Fi naming patterns usually indicate public APs."""

    ssid = _normalized_ssid(ap)
    if ssid in PUBLIC_SSIDS:
        return ApClassification(ApType.PUBLIC, HIGH_CONFIDENCE)
    if ssid is not None and _is_open(ap) and PUBLIC_SSID_PATTERN.search(ssid):
        return ApClassification(ApType.PUBLIC, MEDIUM_CONFIDENCE)
    return None


def _iot_ap(ap: AccessPoint) -> ApClassification | None:
    """Setup-mode and appliance SSID names usually indicate IoT access points."""

    ssid = _normalized_ssid(ap)
    vendor = _normalized_vendor(ap.vendor_oui)
    if _vendor_matches(vendor, IOT_VENDOR_MARKERS):
        return ApClassification(ApType.IOT, HIGH_CONFIDENCE)
    if ssid is not None and IOT_SSID_PATTERN.search(ssid):
        return ApClassification(ApType.IOT, MEDIUM_CONFIDENCE)
    return None


def _personal_ap(ap: AccessPoint) -> ApClassification | None:
    """ISP-default router names usually indicate personal or small-office APs."""

    ssid = _normalized_ssid(ap)
    if ssid is not None and PERSONAL_SSID_PATTERN.search(ssid):
        return ApClassification(ApType.PERSONAL, MEDIUM_CONFIDENCE)
    return None


def _wearable_client(client: Client, _: list[str]) -> ClientClassification | None:
    """Wearable vendors are distinctive enough to classify without probe behavior."""

    if _vendor_matches(_normalized_vendor(client.vendor_oui), WEARABLE_VENDOR_MARKERS):
        return ClientClassification(DeviceClass.WEARABLE, HIGH_CONFIDENCE)
    return None


def _mobile_client(client: Client, probe_history: list[str]) -> ClientClassification | None:
    """Mobile vendors with several remembered networks are likely phones or tablets."""

    vendor = _normalized_vendor(client.vendor_oui)
    unique_probes = _unique_probe_count(probe_history)
    if _vendor_matches(vendor, MOBILE_VENDOR_MARKERS) and unique_probes >= MOBILE_PROBE_MINIMUM:
        return ClientClassification(DeviceClass.MOBILE, HIGH_CONFIDENCE)
    if _vendor_matches(vendor, MOBILE_VENDOR_MARKERS):
        return ClientClassification(DeviceClass.MOBILE, LOW_CONFIDENCE)
    return None


def _laptop_client(client: Client, probe_history: list[str]) -> ClientClassification | None:
    """PC NIC vendors usually indicate laptops even when probe history is sparse."""

    if not _vendor_matches(_normalized_vendor(client.vendor_oui), LAPTOP_VENDOR_MARKERS):
        return None
    if _unique_probe_count(probe_history) >= LAPTOP_PROBE_MINIMUM:
        return ClientClassification(DeviceClass.LAPTOP, HIGH_CONFIDENCE)
    return ClientClassification(DeviceClass.LAPTOP, MEDIUM_CONFIDENCE)


def _iot_client(client: Client, probe_history: list[str]) -> ClientClassification | None:
    """IoT vendors or long single-AP associations usually indicate fixed devices."""

    if _vendor_matches(_normalized_vendor(client.vendor_oui), IOT_VENDOR_MARKERS):
        return ClientClassification(DeviceClass.IOT, HIGH_CONFIDENCE)
    if (
        client.associated_bssid is not None
        and _unique_probe_count(probe_history) <= IOT_PROBE_MAXIMUM
        and client.last_seen - client.first_seen >= timedelta(days=IOT_ANCHOR_DAYS)
    ):
        return ClientClassification(DeviceClass.IOT, MEDIUM_CONFIDENCE)
    return None


def _normalized_ssid(ap: AccessPoint) -> str | None:
    if ap.ssid is None:
        return None
    return ap.ssid.strip().lower()


def _normalized_vendor(vendor: str | None) -> str:
    return "" if vendor is None else vendor.strip().lower()


def _normalized_encryption(ap: AccessPoint) -> set[str]:
    return {value.strip().lower() for value in ap.encryption}


def _is_open(ap: AccessPoint) -> bool:
    encryption = _normalized_encryption(ap)
    return not encryption or "open" in encryption or "none" in encryption


def _vendor_matches(vendor: str, markers: frozenset[str]) -> bool:
    return any(marker in vendor for marker in markers)


def _unique_probe_count(probe_history: list[str]) -> int:
    return len({probe.strip().lower() for probe in probe_history if probe.strip()})
