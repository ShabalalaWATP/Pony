# SPDX-License-Identifier: AGPL-3.0-only
"""Configuration loading for the Raspberry Pi sensor-agent."""

from __future__ import annotations

import tomllib
from pathlib import Path

from pydantic import BaseModel, Field, ValidationError, field_validator

WS_SCHEME = "ws" + "://"
WSS_SCHEME = "wss" + "://"
DEFAULT_KISMET_EVENT_WS_URL = f"{WS_SCHEME}localhost:2501/eventbus/events.ws"


class SensorConfig(BaseModel):
    """Runtime configuration for one sensor."""

    sensor_id: str = Field(min_length=1, max_length=96)
    sensor_name: str = Field(min_length=1, max_length=128)
    backend_ws_url: str = Field(min_length=1)
    client_cert_path: Path
    client_key_path: Path
    ca_cert_path: Path | None = None
    kismet_base_url: str = "http://localhost:2501"
    kismet_event_ws_url: str = DEFAULT_KISMET_EVENT_WS_URL
    local_http_host: str = "127.0.0.1"
    local_http_port: int = Field(default=9090, ge=1, le=65535)
    manage_kismet: bool = False
    kismet_user_service: bool = True
    version: str = "0.1.0"

    @field_validator("backend_ws_url", "kismet_event_ws_url")
    @classmethod
    def validate_ws_url(cls, value: str) -> str:
        """Ensure WebSocket URLs use WebSocket transport.

        Args:
            value: Configured WebSocket URL.

        Returns:
            The validated URL.
        """

        if not value.startswith((WS_SCHEME, WSS_SCHEME)):
            msg = f"WebSocket URLs must start with {WS_SCHEME} or {WSS_SCHEME}"
            raise ValueError(msg)
        return value


def load_config(path: Path) -> SensorConfig:
    """Load sensor configuration from a TOML file.

    Args:
        path: Path to the TOML configuration file.

    Returns:
        Parsed sensor configuration.

    Raises:
        FileNotFoundError: If the file does not exist.
        ValidationError: If the TOML data is invalid.
    """

    data = tomllib.loads(path.read_text(encoding="utf-8"))
    try:
        return SensorConfig.model_validate(data)
    except ValidationError:
        raise
