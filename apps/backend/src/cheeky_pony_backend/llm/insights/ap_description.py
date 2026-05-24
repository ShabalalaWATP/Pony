# SPDX-License-Identifier: AGPL-3.0-only
"""Access-point description prompt builder and response schema."""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta

from pydantic import BaseModel, ConfigDict, Field

from cheeky_pony_backend.domain.anomaly import AnomalyContribution, score_access_point
from cheeky_pony_backend.domain.labelling import (
    ApType,
    DeviceClass,
    classify_ap,
    classify_client,
    threshold_ap_label,
    threshold_client_label,
)
from cheeky_pony_backend.domain.oui_lookup import OuiService
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.llm.types import InsightConfidence
from cheeky_pony_shared import AccessPoint, Client, Event, SignalSample

_BSSID_RE = re.compile(r"^[0-9a-f]{12}$")
_AP_SCAN_LIMIT = 500
_CLIENT_LIMIT = 500
_EVENT_SCAN_LIMIT = 500
_DEAUTH_WINDOW = timedelta(minutes=5)


class ApDescriptionResponse(BaseModel):
    """Validated model response for AP-description insights."""

    model_config = ConfigDict(extra="forbid")

    summary: str = Field(min_length=1, max_length=600)
    bullet_points: list[str] = Field(default_factory=list, max_length=5)
    confidence: InsightConfidence


class CountItem(BaseModel):
    """Prompt-safe count bucket."""

    model_config = ConfigDict(extra="forbid")

    kind: str = Field(min_length=1, max_length=128)
    count: int = Field(ge=0)


class SignalSummary(BaseModel):
    """Prompt-safe RSSI signal summary."""

    model_config = ConfigDict(extra="forbid")

    avg_rssi_dbm: float | None
    first_sample_at: datetime | None
    last_sample_at: datetime | None
    max_rssi_dbm: int | None
    min_rssi_dbm: int | None
    sample_count: int = Field(ge=0)


class ApDescriptionAccessPoint(BaseModel):
    """Prompt-safe AP metadata."""

    model_config = ConfigDict(extra="forbid")

    anomaly_reasons: list[str]
    anomaly_score: int = Field(ge=0, le=100)
    band: str | None
    channel: int | None
    encryption: list[str]
    flags: list[str]
    hidden: bool
    label: ApType
    label_confidence: float = Field(ge=0.0, le=1.0)
    ssid: str | None
    vendor: str | None


class AssociatedClientSummary(BaseModel):
    """Prompt-safe associated-client aggregate summary."""

    model_config = ConfigDict(extra="forbid")

    count: int = Field(ge=0)
    device_class_mix: list[CountItem]
    vendor_mix: list[CountItem]


class ApDescriptionPromptContext(BaseModel):
    """Structured prompt context for one AP description."""

    model_config = ConfigDict(extra="forbid")

    access_point: ApDescriptionAccessPoint
    associated_clients: AssociatedClientSummary
    signal: SignalSummary


async def build_ap_description_context(
    store: Store,
    bssid: str,
    *,
    oui: OuiService,
    label_confidence_threshold: float,
) -> ApDescriptionPromptContext | None:
    """Build deterministic structured context for one access point."""

    normalized = normalize_bssid(bssid)
    if normalized is None:
        return None
    ap = await store.get_access_point(normalized)
    if ap is None:
        return None
    clients, client_total = await store.list_clients_for_access_point(normalized, _CLIENT_LIMIT, 0)
    access_points, _ = await store.list_access_points(_AP_SCAN_LIMIT, 0)
    events, _ = await store.list_events(_EVENT_SCAN_LIMIT, 0)
    ap_for_analysis = _resolve_ap_vendor(ap, oui)
    return ApDescriptionPromptContext(
        access_point=_ap_context(
            ap_for_analysis,
            access_points,
            events,
            client_total,
            label_confidence_threshold,
        ),
        associated_clients=_client_summary(clients, client_total, oui, label_confidence_threshold),
        signal=_signal_summary(ap.signal_history),
    )


def normalize_bssid(value: str) -> str | None:
    """Normalize a BSSID accepted by path routes into uppercase colon form."""

    compact = re.sub(r"[^0-9A-Fa-f]", "", value).lower()
    if not _BSSID_RE.fullmatch(compact):
        return None
    return ":".join(compact[index : index + 2] for index in range(0, 12, 2)).upper()


def _ap_context(
    ap: AccessPoint,
    access_points: list[AccessPoint],
    events: list[Event],
    associated_client_count: int,
    label_confidence_threshold: float,
) -> ApDescriptionAccessPoint:
    classification = threshold_ap_label(classify_ap(ap), label_confidence_threshold)
    score, reasons = score_access_point(
        ap,
        same_ssid_peers=_same_ssid_peers(ap, access_points),
        recent_deauths=_recent_deauths(events, ap.bssid),
        associated_client_count=associated_client_count,
    )
    return ApDescriptionAccessPoint(
        anomaly_reasons=[_reason_text(reason) for reason in reasons],
        anomaly_score=score,
        band=ap.band,
        channel=ap.channel,
        encryption=ap.encryption,
        flags=ap.flags,
        hidden=ap.ssid is None,
        label=classification.label,
        label_confidence=classification.confidence,
        ssid=ap.ssid,
        vendor=ap.vendor_oui,
    )


def _client_summary(
    clients: list[Client],
    total: int,
    oui: OuiService,
    label_confidence_threshold: float,
) -> AssociatedClientSummary:
    resolved = [_resolve_client_vendor(client, oui) for client in clients]
    return AssociatedClientSummary(
        count=total,
        device_class_mix=_count_items(
            _client_class(client, label_confidence_threshold).value for client in resolved
        ),
        vendor_mix=_count_items(client.vendor_oui or "unknown" for client in resolved),
    )


def _signal_summary(samples: list[SignalSample]) -> SignalSummary:
    if not samples:
        return SignalSummary(
            avg_rssi_dbm=None,
            first_sample_at=None,
            last_sample_at=None,
            max_rssi_dbm=None,
            min_rssi_dbm=None,
            sample_count=0,
        )
    rssi_values = [sample.rssi_dbm for sample in samples]
    sample_times = sorted(sample.seen_at for sample in samples)
    return SignalSummary(
        avg_rssi_dbm=round(sum(rssi_values) / len(rssi_values), 2),
        first_sample_at=sample_times[0],
        last_sample_at=sample_times[-1],
        max_rssi_dbm=max(rssi_values),
        min_rssi_dbm=min(rssi_values),
        sample_count=len(samples),
    )


def _resolve_ap_vendor(ap: AccessPoint, oui: OuiService) -> AccessPoint:
    vendor = oui.lookup(ap.bssid)
    if vendor is None:
        return ap
    return ap.model_copy(update={"vendor_oui": vendor.long_vendor})


def _resolve_client_vendor(client: Client, oui: OuiService) -> Client:
    vendor = oui.lookup(client.mac)
    if vendor is None:
        return client
    return client.model_copy(update={"vendor_oui": vendor.long_vendor})


def _client_class(client: Client, label_confidence_threshold: float) -> DeviceClass:
    return threshold_client_label(
        classify_client(client, client.probes),
        label_confidence_threshold,
    ).label


def _same_ssid_peers(ap: AccessPoint, access_points: list[AccessPoint]) -> list[AccessPoint]:
    if ap.ssid is None:
        return []
    return [
        peer
        for peer in access_points
        if peer.bssid.upper() != ap.bssid.upper() and peer.ssid == ap.ssid
    ]


def _recent_deauths(events: list[Event], bssid: str) -> int:
    cutoff = datetime.now(tz=UTC) - _DEAUTH_WINDOW
    return sum(1 for event in events if _event_matches_deauth(event, bssid, cutoff))


def _event_matches_deauth(event: Event, bssid: str, cutoff: datetime) -> bool:
    return (
        event.occurred_at >= cutoff
        and _payload_mentions_deauth(event.payload)
        and _payload_mentions_bssid(event.payload, bssid)
    )


def _payload_mentions_deauth(value: object) -> bool:
    if isinstance(value, str):
        return "deauth" in value.lower()
    if isinstance(value, dict):
        return any(_payload_mentions_deauth(item) for item in value.values())
    if isinstance(value, list):
        return any(_payload_mentions_deauth(item) for item in value)
    return False


def _payload_mentions_bssid(value: object, bssid: str) -> bool:
    if isinstance(value, str):
        return normalize_bssid(value) == bssid.upper()
    if isinstance(value, dict):
        return any(_payload_mentions_bssid(item, bssid) for item in value.values())
    if isinstance(value, list):
        return any(_payload_mentions_bssid(item, bssid) for item in value)
    return False


def _reason_text(reason: AnomalyContribution) -> str:
    return f"{reason.reason.value}: {reason.detail}"


def _count_items(values: Iterable[str]) -> list[CountItem]:
    counts = Counter(values)
    return [CountItem(kind=kind, count=counts[kind]) for kind in sorted(counts)]
