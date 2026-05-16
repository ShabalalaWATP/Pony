# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for top-level sensor-agent orchestration helpers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from cheeky_pony_sensor.config import SensorConfig
from cheeky_pony_sensor.service import SensorAgent
from cheeky_pony_shared import CommandKind, SensorCommand


async def test_sensor_agent_status_and_command_handling(tmp_path: Path) -> None:
    """SensorAgent exposes status and dispatches passive commands."""

    cert_path, key_path = _write_cert(tmp_path)
    config = SensorConfig(
        sensor_id="pi-1",
        sensor_name="Pi 1",
        backend_ws_url="wss://backend/ws/sensor-gateway",
        client_cert_path=cert_path,
        client_key_path=key_path,
        version="0.1.0",
    )
    agent = SensorAgent(config)

    result = await agent.handle_command(SensorCommand(id="cmd-1", kind=CommandKind.START_CAPTURE))
    await agent.emit_status({"ok": True})

    assert agent.status_payload()["sensor_id"] == "pi-1"
    assert result["outcome"] == "capture_started"
    queued = await agent._backend._queue.get()
    assert queued.payload == {"ok": True}


def _write_cert(tmp_path: Path) -> tuple[Path, Path]:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "pi-1")])
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.now(tz=UTC))
        .not_valid_after(datetime.now(tz=UTC) + timedelta(days=1))
        .sign(key, hashes.SHA256())
    )
    cert_path = tmp_path / "client.crt"
    key_path = tmp_path / "client.key"
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    return cert_path, key_path
