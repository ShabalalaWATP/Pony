# SPDX-License-Identifier: AGPL-3.0-only
"""Client certificate generation for registered sensors."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID


class SensorCertificateBundle:
    """PEM-encoded certificate material returned once at registration."""

    def __init__(self, certificate_pem: str, private_key_pem: str, ca_certificate_pem: str) -> None:
        self.certificate_pem = certificate_pem
        self.private_key_pem = private_key_pem
        self.ca_certificate_pem = ca_certificate_pem


def issue_sensor_certificate(sensor_id: str) -> SensorCertificateBundle:
    """Issue a short-lived self-signed client certificate for a sensor.

    Args:
        sensor_id: Sensor identifier embedded as the common name.

    Returns:
        PEM certificate bundle.
    """

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name(
        [
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Cheeky Pony"),
            x509.NameAttribute(NameOID.COMMON_NAME, sensor_id),
        ]
    )
    now = datetime.now(tz=UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + timedelta(days=365))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    cert_pem = cert.public_bytes(serialization.Encoding.PEM).decode("ascii")
    key_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode("ascii")
    return SensorCertificateBundle(cert_pem, key_pem, cert_pem)
