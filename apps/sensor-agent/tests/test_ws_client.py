# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for backend WebSocket client helpers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from cheeky_pony_sensor.ws_client import build_ssl_context, next_backoff


def test_next_backoff_uses_exponential_cap(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """Reconnect backoff grows exponentially and includes patched jitter."""

    monkeypatch.setattr("random.uniform", lambda _start, _end: 0.0)

    assert next_backoff(0) == 0.5
    assert next_backoff(2) == 2.0
    assert next_backoff(20) == 30.0


def test_build_ssl_context_loads_client_certificate(tmp_path: Path) -> None:
    """mTLS context loads a generated client certificate and key."""

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

    context = build_ssl_context(cert_path, key_path, None)

    assert context is not None
