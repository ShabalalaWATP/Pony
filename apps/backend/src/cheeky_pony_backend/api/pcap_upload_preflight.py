# SPDX-License-Identifier: AGPL-3.0-only
"""Pre-body guards for PCAP multipart uploads."""

from __future__ import annotations

import re
from urllib.parse import unquote

from fastapi import Request, Response, status
from fastapi.responses import JSONResponse

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.security import CsrfService, TokenService

_PCAP_UPLOAD_PATH = re.compile(r"^/api/v1/engagements/([^/]+)/pcaps/?$")
_MULTIPART_OVERHEAD_BYTES = 1024 * 1024


async def pcap_upload_preflight_response(
    request: Request,
    settings: Settings,
) -> Response | None:
    """Reject unsafe PCAP uploads before multipart body parsing."""

    engagement_id = _engagement_id(request)
    if engagement_id is None:
        return None
    store: Store = request.app.state.store
    audit = AuditLogger(store)
    user = await _authenticated_user(request, settings, store, audit, engagement_id)
    if isinstance(user, Response):
        return user
    csrf_response = await _csrf_response(request, settings, audit, user, engagement_id)
    if csrf_response is not None:
        return csrf_response
    authz_response = await _authorization_response(settings, store, audit, user, engagement_id)
    if authz_response is not None:
        return authz_response
    return await _content_length_response(request, settings, audit, user, engagement_id)


async def _authenticated_user(
    request: Request,
    settings: Settings,
    store: Store,
    audit: AuditLogger,
    engagement_id: str,
) -> UserRecord | Response:
    token = _bearer_token(request) or request.cookies.get("access_token")
    if token is None:
        await _audit_refusal(audit, "system:anonymous", engagement_id, "authentication_required")
        return _json_refusal(status.HTTP_401_UNAUTHORIZED, "authentication_required")
    try:
        claims = TokenService(settings).verify(token, "access")
    except Exception:
        await _audit_refusal(audit, "system:anonymous", engagement_id, "invalid_token")
        return _json_refusal(status.HTTP_401_UNAUTHORIZED, "invalid_token")
    actor_id = str(claims.get("sub", "system:anonymous"))
    user = await store.get_user(actor_id)
    if user is None or user.disabled:
        await _audit_refusal(audit, actor_id, engagement_id, "invalid_user")
        return _json_refusal(status.HTTP_401_UNAUTHORIZED, "invalid_user")
    return user


async def _csrf_response(
    request: Request,
    settings: Settings,
    audit: AuditLogger,
    user: UserRecord,
    engagement_id: str,
) -> Response | None:
    token = _bearer_token(request) or request.cookies.get("access_token")
    if token is None:
        return None
    claims = TokenService(settings).verify(token, "access")
    csrf_header = request.headers.get("x-csrf-token")
    if CsrfService().verify(str(claims.get("csrf")), csrf_header):
        return None
    await _audit_refusal(audit, user.id, engagement_id, "invalid_csrf")
    return Response(status_code=status.HTTP_403_FORBIDDEN)


async def _authorization_response(
    settings: Settings,
    store: Store,
    audit: AuditLogger,
    user: UserRecord,
    engagement_id: str,
) -> Response | None:
    if not user.is_admin():
        await _audit_refusal(audit, user.id, engagement_id, "admin_required")
        return _json_refusal(status.HTTP_403_FORBIDDEN, "admin_required")
    if not user.has_recent_totp(settings.totp_recent_minutes):
        await _audit_refusal(audit, user.id, engagement_id, "totp_required")
        return _json_refusal(status.HTTP_403_FORBIDDEN, "totp_required")
    engagement = await store.get_engagement(engagement_id)
    if engagement is None:
        await _audit_refusal(audit, user.id, engagement_id, "not_found")
        return _json_refusal(status.HTTP_404_NOT_FOUND, "engagement_not_found")
    if engagement.ended_at is not None:
        await _audit_refusal(audit, user.id, engagement_id, "inactive")
        return _json_refusal(status.HTTP_409_CONFLICT, "engagement_inactive")
    return None


async def _content_length_response(
    request: Request,
    settings: Settings,
    audit: AuditLogger,
    user: UserRecord,
    engagement_id: str,
) -> Response | None:
    raw_length = request.headers.get("content-length")
    if raw_length is None:
        await _audit_refusal(audit, user.id, engagement_id, "content_length_required")
        return _json_refusal(status.HTTP_411_LENGTH_REQUIRED, "content_length_required")
    try:
        content_length = int(raw_length)
    except ValueError:
        await _audit_refusal(audit, user.id, engagement_id, "invalid_content_length")
        return _json_refusal(status.HTTP_400_BAD_REQUEST, "invalid_content_length")
    if content_length <= _max_upload_body_bytes(settings):
        return None
    await audit.record(
        user.id,
        "pcap.upload.refused",
        {"engagement_id": engagement_id},
        {"content_length": content_length, "max_body_bytes": _max_upload_body_bytes(settings)},
        "denied:request_too_large",
    )
    return _json_refusal(status.HTTP_413_CONTENT_TOO_LARGE, "request_too_large")


async def _audit_refusal(
    audit: AuditLogger,
    actor_id: str,
    engagement_id: str,
    reason: str,
) -> None:
    await audit.record(
        actor_id,
        "pcap.upload.refused",
        {"engagement_id": engagement_id},
        {},
        f"denied:{reason}",
    )


def _engagement_id(request: Request) -> str | None:
    if request.method != "POST":
        return None
    match = _PCAP_UPLOAD_PATH.match(request.url.path)
    return unquote(match.group(1)) if match is not None else None


def _max_upload_body_bytes(settings: Settings) -> int:
    return settings.pcap_max_upload_mb * 1024 * 1024 + _MULTIPART_OVERHEAD_BYTES


def _json_refusal(status_code: int, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"detail": detail})


def _bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:]
    return None
