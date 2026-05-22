# SPDX-License-Identifier: AGPL-3.0-only
"""Deterministic profile helpers for synthetic demo data."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

DEMO_CENTER_LATITUDE = 51.5074
DEMO_CENTER_LONGITUDE = -0.1278
DEMO_AP_GEO_SPREAD_DEGREES = 0.3
DEMO_SENSOR_GEO_SPREAD_DEGREES = 0.035
GEOLESS_AP_INTERVAL = 10

_HIDDEN_SSID_INDICES = frozenset({9, 27, 43})
_DEMO_SSID_POOL = (
    "BTHub6-A2C",
    "Sky_FAB23",
    "VM5432920",
    "TALKTALK-1A2B",
    "PlusnetWireless2A",
    "EE-Hub-8F12",
    "VodafoneConnect-91D4",
    "NOWTV-6C8A",
    "ZenWiFi-Office",
    "Hyperoptic-7301",
    "Starbucks WiFi",
    "_The Cloud",
    "BTWi-fi",
    "BT-WiFi",
    "BTWiFi-x",
    "O2 Wifi",
    "EE WiFi",
    "Costa Free WiFi",
    "Train_WiFi",
    "HotelGuest",
    "Sam's iPhone",
    "Galaxy-S22",
    "Pixel 7 Pro",
    "iPhone-Laura",
    "OnePlus Hotspot",
    "AcmeCorp-Guest",
    "AcmeCorp-Internal",
    "InitechVPN",
    "Globex-Staff",
    "UmbrellaGuest",
    "FREE-WIFI",
    "Nest-Setup-4B2",
    "Ring-Setup-7A",
    "Sonos-Office",
    "HP-Print-7421",
    "Epson-Setup",
    "Canon_MG3600",
    "TP-Link_4C21",
    "ASUS_AX88U",
    "NETGEAR72",
    "Ubiquiti-Lab",
    "UniFi Guest",
    "Warehouse-IoT",
    "CCTV-Backhaul",
    "SmartMeter-Bridge",
    "CafePOS",
    "Guest-2G",
    "Guest-5G",
    "Operations",
    "Maintenance",
)


@dataclass(frozen=True)
class DemoClientVendor:
    """Vendor profile encoded into synthetic client MAC prefixes."""

    local_prefix_byte: int
    name: str
    mobile: bool


_CLIENT_VENDOR_PROFILES = (
    DemoClientVendor(0x10, "Apple, Inc.", True),
    DemoClientVendor(0x11, "Samsung Electronics Co., Ltd", True),
    DemoClientVendor(0x12, "Google LLC", True),
    DemoClientVendor(0x13, "OnePlus Technology", True),
    DemoClientVendor(0x14, "Xiaomi Communications Co Ltd", True),
    DemoClientVendor(0x20, "Intel Corporate", False),
    DemoClientVendor(0x21, "Dell Inc.", False),
    DemoClientVendor(0x22, "HP Inc.", False),
    DemoClientVendor(0x30, "Espressif Inc.", False),
    DemoClientVendor(0x31, "Sonos, Inc.", False),
    DemoClientVendor(0x32, "Amazon Technologies Inc.", False),
    DemoClientVendor(0x33, "Raspberry Pi Trading Ltd", False),
)
_CLIENT_VENDOR_BY_PREFIX = {
    f"02:00:{profile.local_prefix_byte:02X}": profile for profile in _CLIENT_VENDOR_PROFILES
}


def demo_sensor_geo(sensor_id: str) -> tuple[float, float]:
    """Return a stable synthetic sensor position near the demo center."""

    return _geo_point(sensor_id, DEMO_SENSOR_GEO_SPREAD_DEGREES)


def demo_access_point_geo(bssid: str, index: int) -> tuple[float, float] | None:
    """Return stable AP geo, leaving a small hidden-location sample."""

    if index % GEOLESS_AP_INTERVAL == GEOLESS_AP_INTERVAL - 1:
        return None
    return _geo_point(bssid, DEMO_AP_GEO_SPREAD_DEGREES)


def demo_ssids(count: int) -> list[str | None]:
    """Return deterministic unique SSIDs with a few hidden APs."""

    assigned: set[str] = set()
    ssids: list[str | None] = []
    for index in range(count):
        if index in _HIDDEN_SSID_INDICES:
            ssids.append(None)
            continue
        ssid = _unique_ssid(index, assigned)
        assigned.add(ssid)
        ssids.append(ssid)
    return ssids


def demo_client_mac(index: int) -> str:
    """Return a synthetic MAC with a vendor-coded local prefix."""

    profile = _CLIENT_VENDOR_PROFILES[
        _stable_index(f"vendor:{index}", len(_CLIENT_VENDOR_PROFILES))
    ]
    mid = (index >> 8) & 0xFF
    low = index & 0xFF
    return f"02:00:{profile.local_prefix_byte:02X}:00:{mid:02X}:{low:02X}"


def demo_client_vendor(mac: str) -> DemoClientVendor:
    """Resolve the synthetic vendor profile encoded in a demo client MAC."""

    prefix = ":".join(mac.upper().split(":")[:3])
    return _CLIENT_VENDOR_BY_PREFIX[prefix]


def demo_client_probes(index: int, associated_ssid: str | None, mobile: bool) -> list[str]:
    """Return plausible deterministic probe history for one client."""

    if not mobile:
        return [] if index % 3 else ([associated_ssid] if associated_ssid else [])
    count = 4 + _stable_index(f"probe-count:{index}", 5)
    probes = _stable_sample(_DEMO_SSID_POOL, count, f"probe:{index}")
    if associated_ssid is not None and associated_ssid not in probes:
        probes[0] = associated_ssid
    return probes


def demo_probe_ssid(index: int) -> str:
    """Return a realistic SSID for synthetic probe-request events."""

    return _DEMO_SSID_POOL[_stable_index(f"probe-event:{index}", len(_DEMO_SSID_POOL))]


def _unique_ssid(index: int, assigned: set[str]) -> str:
    start = _stable_index(f"ssid:{index}", len(_DEMO_SSID_POOL))
    for offset in range(len(_DEMO_SSID_POOL)):
        candidate = _DEMO_SSID_POOL[(start + offset) % len(_DEMO_SSID_POOL)]
        if candidate not in assigned:
            return candidate
    msg = "demo SSID pool exhausted"
    raise RuntimeError(msg)


def _geo_point(key: str, spread_degrees: float) -> tuple[float, float]:
    digest = hashlib.sha256(key.encode("ascii")).digest()
    latitude = DEMO_CENTER_LATITUDE + _geo_offset(digest[:4], spread_degrees)
    longitude = DEMO_CENTER_LONGITUDE + _geo_offset(digest[4:8], spread_degrees)
    return round(latitude, 6), round(longitude, 6)


def _geo_offset(raw_bytes: bytes, spread_degrees: float) -> float:
    raw_value = int.from_bytes(raw_bytes, byteorder="big")
    scale = raw_value / 0xFFFFFFFF
    return ((scale * 2) - 1) * spread_degrees


def _stable_index(key: str, modulo: int) -> int:
    digest = hashlib.sha256(key.encode("ascii")).digest()
    return int.from_bytes(digest[:4], byteorder="big") % modulo


def _stable_sample(values: tuple[str, ...], count: int, key: str) -> list[str]:
    ranked = sorted(values, key=lambda value: hashlib.sha256(f"{key}:{value}".encode()).digest())
    return ranked[:count]
