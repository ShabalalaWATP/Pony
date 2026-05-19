# SPDX-License-Identifier: AGPL-3.0-only
"""Pydantic domain contracts shared across Cheeky Pony services."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


def utc_now() -> datetime:
    """Return the current UTC timestamp.

    Returns:
        A timezone-aware UTC datetime.
    """

    return datetime.now(tz=UTC)


class SensorCapability(StrEnum):
    """Capabilities advertised by a sensor."""

    PASSIVE_CAPTURE = "passive_capture"
    CHANNEL_CONTROL = "channel_control"
    ACTIVE_MODULES = "active_modules"
    ROGUE_AP = "rogue_ap"
    DEAUTH = "deauth"
    EVIL_TWIN = "evil_twin"
    CAPTIVE_PORTAL = "captive_portal"
    MITM = "mitm"
    GEO = "geo"


class EventKind(StrEnum):
    """Normalized event kinds emitted by sensors."""

    ACCESS_POINT_SEEN = "access_point_seen"
    CLIENT_SEEN = "client_seen"
    PROBE_REQUEST = "probe_request"
    ASSOCIATION = "association"
    SENSOR_STATUS = "sensor_status"
    COMMAND_RESULT = "command_result"


class AlertSeverity(StrEnum):
    """Alert severity buckets."""

    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class TargetKind(StrEnum):
    """Target identifier kinds used by active-operation allow-lists."""

    BSSID = "bssid"
    SSID = "ssid"
    CLIENT_MAC = "client_mac"


class CommandKind(StrEnum):
    """Commands sent from backend to sensors."""

    RESTART = "restart"
    UPDATE = "update"
    START_CAPTURE = "start_capture"
    STOP_CAPTURE = "stop_capture"
    SET_CHANNEL = "set_channel"
    START_MODULE = "start_module"
    STOP_MODULE = "stop_module"


class StrictBase(BaseModel):
    """Base model with strict validation settings."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class SignalSample(StrictBase):
    """Signal reading at a point in time."""

    seen_at: datetime = Field(default_factory=utc_now)
    rssi_dbm: int = Field(ge=-127, le=20)


class Sensor(StrictBase):
    """Registered sensor identity and health metadata."""

    id: str = Field(min_length=1, max_length=96)
    name: str = Field(min_length=1, max_length=128)
    tailnet_ip: str = Field(min_length=3, max_length=64)
    last_seen: datetime | None = None
    capabilities: list[SensorCapability] = Field(default_factory=list)
    version: str = Field(min_length=1, max_length=64)
    revoked: bool = False
    client_cert_fingerprint_sha256: str | None = Field(
        default=None,
        pattern=r"^[0-9a-f]{64}$",
    )
    synthetic: bool = False


class AccessPoint(StrictBase):
    """Normalized wireless access point snapshot."""

    bssid: str = Field(pattern=r"^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$")
    ssid: str = Field(default="", max_length=128)
    channel: int | None = Field(default=None, ge=1, le=196)
    band: str | None = Field(default=None, max_length=16)
    encryption: list[str] = Field(default_factory=list)
    first_seen: datetime = Field(default_factory=utc_now)
    last_seen: datetime = Field(default_factory=utc_now)
    signal_history: list[SignalSample] = Field(default_factory=list)
    vendor_oui: str | None = Field(default=None, max_length=128)
    flags: list[str] = Field(default_factory=list)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    location_source: Literal["sensor_gps", "wigle", "manual"] | None = None
    synthetic: bool = False


class Client(StrictBase):
    """Normalized wireless client snapshot."""

    mac: str = Field(pattern=r"^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$")
    vendor_oui: str | None = Field(default=None, max_length=128)
    associated_bssid: str | None = Field(
        default=None,
        pattern=r"^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$",
    )
    probes: list[str] = Field(default_factory=list)
    first_seen: datetime = Field(default_factory=utc_now)
    last_seen: datetime = Field(default_factory=utc_now)
    signal_history: list[SignalSample] = Field(default_factory=list)
    synthetic: bool = False


class Event(StrictBase):
    """Append-only event record."""

    id: str = Field(min_length=1, max_length=128)
    sensor_id: str = Field(min_length=1, max_length=96)
    kind: EventKind
    payload: dict[str, Any]
    occurred_at: datetime = Field(default_factory=utc_now)
    synthetic: bool = False


class Alert(StrictBase):
    """Alert raised by rules or analysis workers."""

    id: str = Field(min_length=1, max_length=128)
    rule_id: str = Field(min_length=1, max_length=128)
    severity: AlertSeverity
    related_entities: list[str] = Field(default_factory=list)
    acked_by: str | None = None
    acked_at: datetime | None = None
    synthetic: bool = False


class AlertRule(StrictBase):
    """Operator-managed alert rule evaluated against normalized events."""

    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=512)
    severity: AlertSeverity
    enabled: bool = True
    predicate: dict[str, Any]
    created_by: str = Field(min_length=1, max_length=128)
    created_at: datetime = Field(default_factory=utc_now)
    synthetic: bool = False


class AuditLog(StrictBase):
    """Append-only audit log entry."""

    id: str = Field(min_length=1, max_length=128)
    actor_id: str = Field(min_length=1, max_length=128)
    action: str = Field(min_length=1, max_length=128)
    target: dict[str, Any] = Field(default_factory=dict)
    parameters: dict[str, Any] = Field(default_factory=dict)
    outcome: str = Field(min_length=1, max_length=128)
    occurred_at: datetime = Field(default_factory=utc_now)
    started_at: datetime | None = None
    finished_at: datetime | None = None
    raw_tool_output_ref: str | None = None


class Engagement(StrictBase):
    """Engagement scope and lifecycle metadata."""

    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=128)
    scope_rules: list[dict[str, Any]] = Field(default_factory=list)
    started_at: datetime = Field(default_factory=utc_now)
    ended_at: datetime | None = None
    synthetic: bool = False


class AllowedTarget(StrictBase):
    """Engagement allow-list entry."""

    kind: TargetKind
    value: str = Field(min_length=1, max_length=128)


class UserPublic(StrictBase):
    """Safe user fields returned from API responses."""

    id: str = Field(min_length=1, max_length=128)
    email: str = Field(min_length=3, max_length=254)
    roles: list[str] = Field(default_factory=list)
    totp_enabled: bool = False


class SystemAcknowledgement(StrictBase):
    """Stored legal acknowledgement record."""

    kind: str = Field(min_length=1, max_length=128)
    accepted_by: str = Field(min_length=1, max_length=128)
    accepted_at: datetime = Field(default_factory=utc_now)
    statement_hash: str = Field(min_length=32, max_length=256)


class SensorCommand(StrictBase):
    """Command sent to a sensor over the gateway WebSocket."""

    id: str = Field(min_length=1, max_length=128)
    kind: CommandKind
    parameters: dict[str, Any] = Field(default_factory=dict)
    interface: str | None = Field(default=None, max_length=64)
    lab_mode: bool = False

    @field_validator("parameters")
    @classmethod
    def validate_parameters(cls, value: dict[str, Any]) -> dict[str, Any]:
        """Validate command parameter shape.

        Args:
            value: Raw command parameters.

        Returns:
            Validated parameters.
        """

        if "channel" in value and not 1 <= int(value["channel"]) <= 196:
            msg = "channel must be between 1 and 196"
            raise ValueError(msg)
        return value


class ApiPage[T](StrictBase):
    """Paginated API response wrapper."""

    items: list[T]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=500)
    offset: int = Field(ge=0)
