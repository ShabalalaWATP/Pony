# SPDX-License-Identifier: AGPL-3.0-only
"""Deterministic synthetic dataset for local Cheeky Pony demos."""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from cheeky_pony_backend.infra.demo_profiles import (
    demo_access_point_geo,
    demo_client_mac,
    demo_client_probes,
    demo_client_vendor,
    demo_probe_ssid,
    demo_sensor_geo,
    demo_ssids,
)
from cheeky_pony_backend.infra.signals_repo import SIGNAL_HISTORY_CAP
from cheeky_pony_shared import (
    AccessPoint,
    Alert,
    AlertRule,
    AlertSeverity,
    AuditLog,
    Client,
    Engagement,
    Event,
    EventKind,
    Sensor,
    SensorCapability,
    SignalSample,
    TargetKind,
)

EVENT_COUNT = 5000

AP_CHANNELS = [1, 6, 11, 36, 44, 149]
AP_ENCRYPTION_PROFILES = [["WPA2"], ["WPA2", "WPA3"], ["open"]]


@dataclass(frozen=True)
class DemoDataset:
    """All records written by the demo seeder."""

    sensors: list[Sensor]
    access_points: list[AccessPoint]
    clients: list[Client]
    events: list[Event]
    alerts: list[Alert]
    alert_rules: list[AlertRule]
    engagements: list[Engagement]
    allow_list: list[dict[str, object]]
    audit_logs: list[AuditLog]


def build_demo_dataset(now: datetime, with_active: bool) -> DemoDataset:
    """Build a deterministic demo dataset using timestamps before now."""

    clock = now.astimezone(UTC)
    rng = random.Random(9009)  # noqa: S311  # nosec B311
    access_points = _access_points(rng, clock)
    clients = _clients(rng, clock, access_points)
    engagements = _engagements(clock, with_active)
    return DemoDataset(
        sensors=_sensors(clock),
        access_points=access_points,
        clients=clients,
        events=_events(rng, clock, access_points, clients),
        alerts=_alerts(clock),
        alert_rules=_alert_rules(clock),
        engagements=engagements,
        allow_list=_allow_list(engagements, access_points),
        audit_logs=_engagement_audit(clock, engagements[0]),
    )


def _sensors(now: datetime) -> list[Sensor]:
    tiers = [
        [SensorCapability.PASSIVE_CAPTURE],
        [SensorCapability.PASSIVE_CAPTURE, SensorCapability.CHANNEL_CONTROL],
        list(SensorCapability),
    ]
    sensors: list[Sensor] = []
    for index, capabilities in enumerate(tiers):
        sensor_id = f"synth-pi-{index}"
        latitude, longitude = demo_sensor_geo(sensor_id)
        sensors.append(
            Sensor(
                id=sensor_id,
                name=f"Synthetic Pi {index}",
                tailnet_ip=f"100.64.90.{10 + index}",
                last_seen=now - timedelta(minutes=5 + index),
                capabilities=capabilities,
                version="demo-1.0.0",
                client_cert_fingerprint_sha256=f"{index + 1:x}" * 64,
                latitude=latitude,
                longitude=longitude,
                location_source="sensor_gps",
                synthetic=True,
            )
        )
    return sensors


def _access_points(rng: random.Random, now: datetime) -> list[AccessPoint]:
    ssids = demo_ssids(50)
    return [_access_point(rng, now, index, ssids[index]) for index in range(50)]


def _access_point(
    rng: random.Random,
    now: datetime,
    index: int,
    ssid: str | None,
) -> AccessPoint:
    bssid = _mac(0xA0, index)
    channel = AP_CHANNELS[index % len(AP_CHANNELS)]
    geo = demo_access_point_geo(bssid, index)
    latitude = None if geo is None else geo[0]
    longitude = None if geo is None else geo[1]
    location_source: Literal["sensor_gps"] | None = None if geo is None else "sensor_gps"
    return AccessPoint(
        bssid=bssid,
        ssid=ssid,
        channel=channel,
        band="2.4" if channel <= 14 else "5",
        encryption=AP_ENCRYPTION_PROFILES[index % len(AP_ENCRYPTION_PROFILES)],
        first_seen=now - timedelta(days=20 + index % 10, minutes=index),
        last_seen=now - timedelta(minutes=5, seconds=index * 11),
        signal_history=_signal_history(rng, now, -45 - (index % 20)),
        vendor_oui="Synthetic",
        flags=["synthetic", "demo"],
        latitude=latitude,
        longitude=longitude,
        location_source=location_source,
        synthetic=True,
    )


def _clients(rng: random.Random, now: datetime, access_points: list[AccessPoint]) -> list[Client]:
    return [_client(rng, now, access_points, index) for index in range(200)]


def _client(
    rng: random.Random,
    now: datetime,
    access_points: list[AccessPoint],
    index: int,
) -> Client:
    mac = demo_client_mac(index)
    vendor = demo_client_vendor(mac)
    access_point = rng.choice(access_points)
    return Client(
        mac=mac,
        vendor_oui=vendor.name,
        associated_bssid=access_point.bssid,
        probes=demo_client_probes(index, access_point.ssid, vendor.mobile),
        first_seen=now - timedelta(days=10 + index % 15, minutes=index),
        last_seen=now - timedelta(minutes=5, seconds=index * 7),
        signal_history=_signal_history(rng, now, -55 - (index % 18)),
        synthetic=True,
    )


def _events(
    rng: random.Random,
    now: datetime,
    access_points: list[AccessPoint],
    clients: list[Client],
) -> list[Event]:
    return [
        Event(
            id=f"synth-event-{index:04d}",
            sensor_id=f"synth-pi-{index % 3}",
            kind=kind,
            payload=_event_payload(rng, kind, access_points, clients),
            occurred_at=_event_time(rng, now, index),
            synthetic=True,
        )
        for index, kind in enumerate(_event_kinds(rng))
    ]


def _event_kinds(rng: random.Random) -> list[EventKind]:
    kinds = [
        EventKind.ACCESS_POINT_SEEN,
        EventKind.CLIENT_SEEN,
        EventKind.PROBE_REQUEST,
        EventKind.ASSOCIATION,
    ]
    weights = [0.45, 0.35, 0.12, 0.08]
    return rng.choices(kinds, weights=weights, k=EVENT_COUNT)


def _event_payload(
    rng: random.Random,
    kind: EventKind,
    access_points: list[AccessPoint],
    clients: list[Client],
) -> dict[str, object]:
    access_point = rng.choice(access_points)
    client = rng.choice(clients)
    if kind == EventKind.ACCESS_POINT_SEEN:
        return access_point.model_dump(mode="json")
    if kind == EventKind.CLIENT_SEEN:
        return client.model_dump(mode="json")
    if kind == EventKind.PROBE_REQUEST:
        probes = client.probes or [demo_probe_ssid(rng.randrange(50))]
        return {"mac": client.mac, "ssid": rng.choice(probes), "synthetic": True}
    return {"mac": client.mac, "bssid": access_point.bssid, "synthetic": True}


def _event_time(rng: random.Random, now: datetime, index: int) -> datetime:
    if index == 0:
        return now - timedelta(days=30)
    if index == EVENT_COUNT - 1:
        return now - timedelta(minutes=5)
    newest = now - timedelta(minutes=5)
    age_seconds = int((rng.random() ** 2) * 30 * 24 * 60 * 60)
    return newest - timedelta(seconds=age_seconds)


def _alerts(now: datetime) -> list[Alert]:
    severities = [
        AlertSeverity.CRITICAL,
        AlertSeverity.CRITICAL,
        AlertSeverity.HIGH,
        AlertSeverity.HIGH,
        AlertSeverity.HIGH,
        AlertSeverity.MEDIUM,
        AlertSeverity.MEDIUM,
        AlertSeverity.MEDIUM,
    ]
    return [
        Alert(
            id=f"synth-alert-{index}",
            rule_id=f"synth-rule-{index % 2}",
            severity=severity,
            related_entities=[_mac(0xA0, index), f"synth-pi-{index % 3}"],
            acked_at=now - timedelta(days=1, minutes=index) if index % 3 == 0 else None,
            synthetic=True,
        )
        for index, severity in enumerate(severities)
    ]


def _alert_rules(now: datetime) -> list[AlertRule]:
    return [
        AlertRule(
            id="synth-rule-0",
            name="Synthetic open AP watch",
            description="Demo-only suspicious synthetic access point activity.",
            severity=AlertSeverity.HIGH,
            predicate={
                "event_kind": "access_point_seen",
                "match": {"ssid": "^(FREE-WIFI|BTWiFi-x)$"},
            },
            created_by="system:seed",
            created_at=now - timedelta(days=2),
            synthetic=True,
        ),
        AlertRule(
            id="synth-rule-1",
            name="Synthetic probe watch",
            description="Demo-only probe request activity.",
            severity=AlertSeverity.CRITICAL,
            predicate={"event_kind": "probe_request", "match": {"ssid": "^synth-probe"}},
            created_by="system:seed",
            created_at=now - timedelta(days=2, minutes=5),
            synthetic=True,
        ),
    ]


def _engagements(now: datetime, with_active: bool) -> list[Engagement]:
    engagements = [
        Engagement(
            id="synth-engagement-ended",
            name="Synthetic ended engagement",
            scope_rules=[{"kind": "bssid_prefix", "value": "02:00:"}],
            started_at=now - timedelta(days=14),
            ended_at=now - timedelta(days=7),
            synthetic=True,
        )
    ]
    if with_active:
        engagements.append(
            Engagement(
                id="synth-engagement-active",
                name="Synthetic active engagement",
                scope_rules=[{"kind": "bssid_prefix", "value": "02:00:"}],
                started_at=now - timedelta(hours=2),
                synthetic=True,
            )
        )
    return engagements


def _allow_list(
    engagements: list[Engagement],
    access_points: list[AccessPoint],
) -> list[dict[str, object]]:
    return [
        {
            "engagement_id": engagement.id,
            "kind": TargetKind.BSSID.value,
            "value": access_points[index].bssid,
            "synthetic": True,
        }
        for engagement in engagements
        for index in range(3)
    ]


def _engagement_audit(now: datetime, engagement: Engagement) -> list[AuditLog]:
    return [
        AuditLog(
            id="synth-audit-engagement-create",
            actor_id="system:seed",
            action="engagement.create",
            target={"engagement_id": engagement.id},
            parameters={"synthetic": True},
            outcome="ok",
            occurred_at=now - timedelta(days=14),
        ),
        AuditLog(
            id="synth-audit-engagement-end",
            actor_id="system:seed",
            action="engagement.end",
            target={"engagement_id": engagement.id},
            parameters={"synthetic": True},
            outcome="ok",
            occurred_at=now - timedelta(days=7),
        ),
    ]


def _signal_history(rng: random.Random, now: datetime, base_rssi: int) -> list[SignalSample]:
    newest = now - timedelta(minutes=5)
    return [
        SignalSample(
            seen_at=newest - timedelta(seconds=(SIGNAL_HISTORY_CAP - index - 1) * 45),
            rssi_dbm=max(-127, min(20, base_rssi + rng.randint(-5, 5))),
        )
        for index in range(SIGNAL_HISTORY_CAP)
    ]


def _mac(kind: int, index: int) -> str:
    high = (index >> 16) & 0xFF
    mid = (index >> 8) & 0xFF
    low = index & 0xFF
    return f"02:00:{kind:02X}:{high:02X}:{mid:02X}:{low:02X}"
