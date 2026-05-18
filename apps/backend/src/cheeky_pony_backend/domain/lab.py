# SPDX-License-Identifier: AGPL-3.0-only
"""Shared lab command contracts and helpers."""

from __future__ import annotations

import re
from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from cheeky_pony_shared import SensorCapability, TargetKind


class LabModule(StrEnum):
    """Supported active lab modules."""

    ROGUE_AP = "rogue-ap"
    DEAUTH = "deauth"
    EVIL_TWIN = "evil-twin"
    CAPTIVE_PORTAL = "captive-portal"
    MITM = "mitm"


class LabTarget(BaseModel):
    """Active lab command target."""

    model_config = ConfigDict(extra="forbid")

    kind: TargetKind
    value: str = Field(min_length=1, max_length=128)

    @model_validator(mode="after")
    def validate_value(self) -> LabTarget:
        """Validate target value by target kind.

        Returns:
            Validated target.
        """

        if self.kind in {TargetKind.BSSID, TargetKind.CLIENT_MAC} and not _MAC_RE.fullmatch(
            self.value
        ):
            raise ValueError("target value must be a MAC address")
        return self


class LabModuleStartRequest(BaseModel):
    """Active lab module start request."""

    model_config = ConfigDict(extra="forbid")

    sensor_id: str = Field(min_length=1, max_length=96)
    engagement_id: str = Field(min_length=1, max_length=128)
    target: LabTarget
    parameters: dict[str, Any] = Field(default_factory=dict)


class LabModuleStartResponse(BaseModel):
    """Active lab module start response."""

    command_id: str
    started_at: datetime


class LabActiveCommand(BaseModel):
    """Active lab command dashboard item."""

    command_id: str
    module: LabModule
    sensor_id: str
    engagement_id: str
    target: LabTarget
    started_at: datetime


class LabStatusResponse(BaseModel):
    """Current lab gate status for operator UI banners."""

    lab_mode: bool
    acknowledgement_on_file: bool
    is_admin_2fa: bool


_MAC_RE = re.compile(r"^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$")
_SENSITIVE_KEYS = ("password", "credential", "secret", "token", "key", "handshake", "code", "otp")
_MODULE_CAPABILITIES: dict[LabModule, SensorCapability] = {
    LabModule.ROGUE_AP: SensorCapability.ROGUE_AP,
    LabModule.DEAUTH: SensorCapability.DEAUTH,
    LabModule.EVIL_TWIN: SensorCapability.EVIL_TWIN,
    LabModule.CAPTIVE_PORTAL: SensorCapability.CAPTIVE_PORTAL,
    LabModule.MITM: SensorCapability.MITM,
}


def module_capability(module: LabModule) -> SensorCapability:
    """Return the sensor capability required by a lab module.

    Args:
        module: Lab module.

    Returns:
        Required sensor capability.
    """

    return _MODULE_CAPABILITIES[module]


def sensor_module_name(module: LabModule | str) -> str:
    """Return the sensor-agent module name for an API module.

    Args:
        module: API module name.

    Returns:
        Sensor-agent module name.
    """

    return str(module).replace("-", "_")


def sanitize_parameters(value: dict[str, Any]) -> dict[str, Any]:
    """Redact sensitive parameter keys before audit logging.

    Args:
        value: Raw parameter dictionary.

    Returns:
        Sanitized parameter dictionary.
    """

    return {str(key): _sanitize_value(str(key), item) for key, item in value.items()}


def _sanitize_value(key: str, value: Any) -> Any:
    if any(marker in key.lower() for marker in _SENSITIVE_KEYS):
        return "[redacted]"
    if isinstance(value, dict):
        return {
            str(item_key): _sanitize_value(str(item_key), item) for item_key, item in value.items()
        }
    if isinstance(value, list):
        return [_sanitize_value("", item) for item in value]
    return value
