# SPDX-License-Identifier: AGPL-3.0-only
"""Backend test helper functions."""

from __future__ import annotations

import pyotp
from conftest import BackendClient

BOOTSTRAP_TOKEN = "bootstrap-" + "token-test"
BOOTSTRAP_HEADERS = {"authorization": f"Bearer {BOOTSTRAP_TOKEN}"}


async def create_verified_admin(bundle: BackendClient) -> str:
    """Create, log in, and TOTP-verify an admin user.

    Args:
        bundle: Backend test client bundle.

    Returns:
        CSRF token for authenticated unsafe requests.
    """

    await bundle.client.post(
        "/api/v1/auth/register",
        headers=BOOTSTRAP_HEADERS,
        json={"email": "admin@example.com", "password": "long-password-123"},
    )
    login = await bundle.client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "long-password-123"},
    )
    csrf = str(login.json()["csrf_token"])
    setup = await bundle.client.post("/api/v1/auth/2fa/setup", headers={"x-csrf-token": csrf})
    secret = str(setup.json()["secret"])
    code = pyotp.TOTP(secret).now()
    await bundle.client.post(
        "/api/v1/auth/2fa/verify",
        json={"code": code},
        headers={"x-csrf-token": csrf},
    )
    return csrf
