# SPDX-License-Identifier: AGPL-3.0-only
"""Kismet device normalization into shared Cheeky Pony contracts."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from cheeky_pony_shared import AccessPoint, Client, Event, EventKind, SignalSample


def normalize_mac(value: object) -> str | None:
    """Normalize a MAC address-like value.

    Args:
        value: Raw value from Kismet.

    Returns:
        Uppercase colon-separated MAC address or None.
    """

    if not isinstance(value, str):
        return None
    compact = value.replace("-", "").replace(":", "").strip()
    if len(compact) != 12:
        return None
    if any(char not in "0123456789abcdefABCDEF" for char in compact):
        return None
    return ":".join(compact[index : index + 2] for index in range(0, 12, 2)).upper()


def parse_kismet_timestamp(value: object) -> datetime:
    """Parse a Kismet timestamp value.

    Args:
        value: Unix timestamp, ISO timestamp, or missing value.

    Returns:
        Timezone-aware UTC datetime.
    """

    if isinstance(value, int | float):
        return datetime.fromtimestamp(float(value), tz=UTC)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed.astimezone(UTC)
        except ValueError:
            pass
    return datetime.now(tz=UTC)


def _extract_string(payload: dict[str, Any], *keys: str, default: str = "") -> str:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str):
            return value
    return default


def _extract_int(payload: dict[str, Any], *keys: str) -> int | None:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value)
    return None


def _extract_list(payload: dict[str, Any], *keys: str) -> list[str]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, list):
            return [str(item) for item in value if item is not None]
        if isinstance(value, str) and value:
            return [value]
    return []


def normalize_access_point(payload: dict[str, Any]) -> AccessPoint | None:
    """Normalize a Kismet access point device.

    Args:
        payload: Raw Kismet device JSON.

    Returns:
        AccessPoint model when a BSSID is present, otherwise None.
    """

    bssid = normalize_mac(payload.get("kismet.device.base.macaddr") or payload.get("macaddr"))
    if bssid is None:
        return None
    last_signal = _extract_int(payload, "kismet.common.signal.last_signal", "last_signal")
    signal_history = []
    if last_signal is not None:
        signal_history.append(SignalSample(rssi_dbm=max(-127, min(20, last_signal))))
    return AccessPoint(
        bssid=bssid,
        ssid=_extract_string(
            payload,
            "dot11.device/dot11.device.last_beaconed_ssid",
            "ssid",
        ),
        channel=_extract_int(payload, "kismet.device.base.channel", "channel"),
        band=_extract_string(payload, "kismet.device.base.frequency_band", "band", default=""),
        encryption=_extract_list(payload, "dot11.device/dot11.device.crypt_set", "encryption"),
        first_seen=parse_kismet_timestamp(payload.get("kismet.device.base.first_time")),
        last_seen=parse_kismet_timestamp(payload.get("kismet.device.base.last_time")),
        signal_history=signal_history,
        vendor_oui=_extract_string(payload, "kismet.device.base.manuf", "vendor_oui") or None,
        flags=_extract_list(payload, "kismet.device.base.tags", "flags"),
    )


def normalize_client(payload: dict[str, Any]) -> Client | None:
    """Normalize a Kismet client device.

    Args:
        payload: Raw Kismet device JSON.

    Returns:
        Client model when a MAC address is present, otherwise None.
    """

    mac = normalize_mac(payload.get("kismet.device.base.macaddr") or payload.get("macaddr"))
    if mac is None:
        return None
    associated = normalize_mac(
        payload.get("dot11.device/dot11.device.last_bssid") or payload.get("associated_bssid")
    )
    last_signal = _extract_int(payload, "kismet.common.signal.last_signal", "last_signal")
    signal_history = []
    if last_signal is not None:
        signal_history.append(SignalSample(rssi_dbm=max(-127, min(20, last_signal))))
    return Client(
        mac=mac,
        vendor_oui=_extract_string(payload, "kismet.device.base.manuf", "vendor_oui") or None,
        associated_bssid=associated,
        probes=_extract_list(payload, "dot11.device/dot11.device.probed_ssid_map", "probes"),
        first_seen=parse_kismet_timestamp(payload.get("kismet.device.base.first_time")),
        last_seen=parse_kismet_timestamp(payload.get("kismet.device.base.last_time")),
        signal_history=signal_history,
    )


def normalize_kismet_device(payload: dict[str, Any], sensor_id: str) -> list[Event]:
    """Normalize one Kismet device JSON object into event records.

    Args:
        payload: Raw Kismet device JSON.
        sensor_id: Sensor identifier.

    Returns:
        Zero or more normalized events.
    """

    device_type = _extract_string(payload, "kismet.device.base.type", "type").lower()
    events: list[Event] = []
    ap = normalize_access_point(payload)
    if ap is not None and ("ap" in device_type or ap.ssid):
        events.append(
            Event(
                id=str(uuid4()),
                sensor_id=sensor_id,
                kind=EventKind.ACCESS_POINT_SEEN,
                payload=ap.model_dump(mode="json"),
            )
        )
    client = normalize_client(payload)
    if client is not None and ("client" in device_type or not events):
        events.append(
            Event(
                id=str(uuid4()),
                sensor_id=sensor_id,
                kind=EventKind.CLIENT_SEEN,
                payload=client.model_dump(mode="json"),
            )
        )
    return events
