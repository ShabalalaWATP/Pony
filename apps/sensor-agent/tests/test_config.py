# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for sensor-agent configuration loading."""

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from cheeky_pony_sensor.config import load_config


def test_load_config_from_toml(tmp_path: Path) -> None:
    """Sensor TOML config is parsed into a validated model."""

    config_path = tmp_path / "sensor.toml"
    config_path.write_text(
        "\n".join(
            [
                'sensor_id = "pi-1"',
                'sensor_name = "Pi 1"',
                'backend_ws_url = "wss://backend/ws/sensor-gateway"',
                f"client_cert_path = '{tmp_path / 'client.crt'}'",
                f"client_key_path = '{tmp_path / 'client.key'}'",
                f"ca_cert_path = '{tmp_path / 'ca.crt'}'",
            ]
        ),
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert config.sensor_id == "pi-1"
    assert config.local_http_port == 9090


def test_kismet_event_ws_url_requires_websocket_scheme(tmp_path: Path) -> None:
    """Kismet event stream URL must use ws:// or wss://."""

    config_path = tmp_path / "sensor.toml"
    config_path.write_text(
        "\n".join(
            [
                'sensor_id = "pi-1"',
                'sensor_name = "Pi 1"',
                'backend_ws_url = "wss://backend/ws/sensor-gateway"',
                'kismet_event_ws_url = "http://localhost:2501/events"',
                f"client_cert_path = '{tmp_path / 'client.crt'}'",
                f"client_key_path = '{tmp_path / 'client.key'}'",
            ]
        ),
        encoding="utf-8",
    )

    with pytest.raises(ValidationError):
        load_config(config_path)
