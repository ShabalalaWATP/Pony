# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for PCAP upload, metadata, and deletion routes."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from conftest import BackendClient
from helpers import create_verified_admin
from httpx import Response

from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.security import PasswordService
from cheeky_pony_shared import Engagement

pytestmark = pytest.mark.asyncio

PCAP_BYTES = b"\xd4\xc3\xb2\xa1" + b"\x02\x00\x04\x00" + b"\x00" * 16


async def test_pcap_lifecycle_upload_list_read_delete(backend_client: BackendClient) -> None:
    """Admin operators can upload, list, read metadata, and delete captures."""

    csrf = await create_verified_admin(backend_client)
    await backend_client.store.create_engagement(Engagement(id="eng-1", name="Live"))

    created = await _upload(backend_client, "eng-1", csrf, "folder\\capture?.pcap", PCAP_BYTES)
    pcap_id = created.json()["id"]
    listed = await backend_client.client.get("/api/v1/engagements/eng-1/pcaps")
    detail = await backend_client.client.get(f"/api/v1/engagements/eng-1/pcaps/{pcap_id}")
    deleted = await backend_client.client.request(
        "DELETE",
        f"/api/v1/engagements/eng-1/pcaps/{pcap_id}",
        headers={"x-csrf-token": csrf},
        json={"confirm": created.json()["filename_sanitized"]},
    )
    missing = await backend_client.client.get(f"/api/v1/engagements/eng-1/pcaps/{pcap_id}")

    assert created.status_code == 201
    assert created.json()["filename_sanitized"] == "capture_.pcap"
    assert created.json()["status"] == "uploaded"
    assert listed.json()["total"] == 1
    assert detail.json()["sha256"] == created.json()["sha256"]
    assert deleted.status_code == 204
    assert missing.status_code == 404
    assert backend_client.pcap_store is not None
    assert backend_client.pcap_store.files == {}
    assert [(log.action, log.outcome) for log in backend_client.store.audit_logs[-5:]] == [
        ("pcap.upload", "ok"),
        ("pcap.list", "ok"),
        ("pcap.read", "ok"),
        ("pcap.delete", "ok"),
        ("pcap.read.refused", "denied:not_found"),
    ]


async def test_pcap_upload_rejects_invalid_magic_without_leftover(
    backend_client: BackendClient,
) -> None:
    """Invalid capture bytes are refused and never persisted."""

    csrf = await create_verified_admin(backend_client)
    await backend_client.store.create_engagement(Engagement(id="eng-1", name="Live"))

    rejected = await _upload(backend_client, "eng-1", csrf, "not-a-capture.gif", b"GIF89a")
    listed = await backend_client.client.get("/api/v1/engagements/eng-1/pcaps")

    assert rejected.status_code == 415
    assert rejected.json()["detail"] == "unsupported_magic"
    assert listed.json()["total"] == 0
    assert backend_client.pcap_store is not None
    assert backend_client.pcap_store.files == {}
    assert backend_client.store.audit_logs[-2].action == "pcap.upload.refused"
    assert backend_client.store.audit_logs[-2].outcome == "denied:unsupported_magic"


async def test_pcap_routes_scope_records_to_engagement(
    backend_client: BackendClient,
) -> None:
    """Cross-engagement pcap probing returns 404 rather than leaking existence."""

    csrf = await create_verified_admin(backend_client)
    await backend_client.store.create_engagement(Engagement(id="eng-x", name="X"))
    await backend_client.store.create_engagement(Engagement(id="eng-y", name="Y"))
    created = await _upload(backend_client, "eng-x", csrf, "capture.pcap", PCAP_BYTES)
    pcap_id = created.json()["id"]

    read_other = await backend_client.client.get(f"/api/v1/engagements/eng-y/pcaps/{pcap_id}")
    delete_other = await backend_client.client.request(
        "DELETE",
        f"/api/v1/engagements/eng-y/pcaps/{pcap_id}",
        headers={"x-csrf-token": csrf},
        json={"confirm": "capture.pcap"},
    )
    read_original = await backend_client.client.get(f"/api/v1/engagements/eng-x/pcaps/{pcap_id}")

    assert read_other.status_code == 404
    assert delete_other.status_code == 404
    assert read_original.status_code == 200
    assert backend_client.store.audit_logs[-3].action == "pcap.read.refused"
    assert backend_client.store.audit_logs[-2].action == "pcap.delete.refused"


async def test_pcap_upload_requires_admin_recent_totp(backend_client: BackendClient) -> None:
    """Operator and stale-admin sessions are refused with audit visibility."""

    await create_verified_admin(backend_client)
    await backend_client.store.create_engagement(Engagement(id="eng-1", name="Live"))
    operator_csrf = await _login_user(backend_client, "operator-1", ["operator"])
    operator_denied = await _upload(
        backend_client, "eng-1", operator_csrf, "capture.pcap", PCAP_BYTES
    )
    stale_admin_csrf = await _login_user(backend_client, "stale-admin", ["admin"])
    stale_denied = await _upload(
        backend_client, "eng-1", stale_admin_csrf, "capture.pcap", PCAP_BYTES
    )

    assert operator_denied.status_code == 403
    assert stale_denied.status_code == 403
    assert operator_denied.json()["detail"] == "admin_required"
    assert stale_denied.json()["detail"] == "totp_required"
    pcap_audits = [
        (log.action, log.outcome)
        for log in backend_client.store.audit_logs
        if log.action.startswith("pcap.")
    ]
    assert pcap_audits[-2:] == [
        ("pcap.upload.refused", "denied:admin_required"),
        ("pcap.upload.refused", "denied:totp_required"),
    ]


async def test_pcap_upload_missing_csrf_is_audited(backend_client: BackendClient) -> None:
    """CSRF middleware refusals still leave PCAP-specific audit rows."""

    await create_verified_admin(backend_client)
    await backend_client.store.create_engagement(Engagement(id="eng-1", name="Live"))

    denied = await backend_client.client.post(
        "/api/v1/engagements/eng-1/pcaps",
        files={"file": ("capture.pcap", PCAP_BYTES, "application/vnd.tcpdump.pcap")},
    )

    assert denied.status_code == 403
    assert backend_client.store.audit_logs[-1].action == "pcap.upload.refused"
    assert backend_client.store.audit_logs[-1].outcome == "denied:invalid_csrf"


async def test_pcap_routes_audit_unauthenticated_refusals(
    backend_client: BackendClient,
) -> None:
    """Unauthenticated PCAP requests leave route-specific audit refusals."""

    await backend_client.store.create_engagement(Engagement(id="eng-1", name="Live"))

    denied = await backend_client.client.post(
        "/api/v1/engagements/eng-1/pcaps",
        files={"file": ("capture.pcap", PCAP_BYTES, "application/vnd.tcpdump.pcap")},
    )

    assert denied.status_code == 401
    assert denied.json()["detail"] == "authentication_required"
    assert backend_client.store.audit_logs[-1].action == "pcap.upload.refused"
    assert backend_client.store.audit_logs[-1].outcome == "denied:authentication_required"


async def test_pcap_delete_requires_exact_filename_confirmation(
    backend_client: BackendClient,
) -> None:
    """Delete refuses mismatched typed confirmation and leaves bytes in place."""

    csrf = await create_verified_admin(backend_client)
    await backend_client.store.create_engagement(Engagement(id="eng-1", name="Live"))
    created = await _upload(backend_client, "eng-1", csrf, "capture.pcap", PCAP_BYTES)

    denied = await backend_client.client.request(
        "DELETE",
        f"/api/v1/engagements/eng-1/pcaps/{created.json()['id']}",
        headers={"x-csrf-token": csrf},
        json={"confirm": "wrong"},
    )

    assert denied.status_code == 409
    assert denied.json()["detail"] == "confirm_mismatch"
    assert backend_client.pcap_store is not None
    assert len(backend_client.pcap_store.files) == 1
    assert backend_client.store.audit_logs[-1].action == "pcap.delete.refused"


async def test_duplicate_pcap_uploads_are_stored_independently(
    backend_client: BackendClient,
) -> None:
    """Duplicate bytes keep independent metadata records for auditability."""

    csrf = await create_verified_admin(backend_client)
    await backend_client.store.create_engagement(Engagement(id="eng-1", name="Live"))

    first = await _upload(backend_client, "eng-1", csrf, "capture.pcap", PCAP_BYTES)
    second = await _upload(backend_client, "eng-1", csrf, "capture.pcap", PCAP_BYTES)
    listed = await backend_client.client.get("/api/v1/engagements/eng-1/pcaps")

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] != second.json()["id"]
    assert first.json()["sha256"] == second.json()["sha256"]
    assert listed.json()["total"] == 2


async def _upload(
    bundle: BackendClient,
    engagement_id: str,
    csrf: str,
    filename: str,
    content: bytes,
) -> Response:
    return await bundle.client.post(
        f"/api/v1/engagements/{engagement_id}/pcaps",
        headers={"x-csrf-token": csrf},
        files={"file": (filename, content, "application/vnd.tcpdump.pcap")},
    )


async def _login_user(bundle: BackendClient, user_id: str, roles: list[str]) -> str:
    password = "long-password-123"
    await bundle.store.create_user(
        UserRecord(
            id=user_id,
            email=f"{user_id}@example.com",
            password_hash=PasswordService().hash_password(password),
            roles=roles,
            totp_verified_at=datetime(2020, 1, 1, tzinfo=UTC) if "admin" in roles else None,
        )
    )
    response = await bundle.client.post(
        "/api/v1/auth/login",
        json={"email": f"{user_id}@example.com", "password": password},
    )
    return str(response.json()["csrf_token"])
