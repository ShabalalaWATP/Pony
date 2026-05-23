# SPDX-License-Identifier: AGPL-3.0-only
"""Shared PCAP route authorization and lookup helpers."""

from __future__ import annotations

import re
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request, status

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.dependencies import (
    get_audit_logger,
    get_pcap_store,
    get_store,
    get_token_service,
)
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.pcap_models import Pcap
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.infra.pcap_store import PcapStore
from cheeky_pony_backend.security import TokenService
from cheeky_pony_shared import Engagement


async def pcap_user(
    request: Request,
    store: Annotated[Store, Depends(get_store)],
    tokens: Annotated[TokenService, Depends(get_token_service)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
) -> UserRecord:
    """Authenticate a PCAP route user and audit authentication refusals."""

    token = _bearer_token(request) or request.cookies.get("access_token")
    action = _request_action(request)
    if token is None:
        await audit_auth_refusal(audit, action, "system:anonymous", "authentication_required")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="authentication_required",
        )
    try:
        claims = tokens.verify(token, "access")
    except jwt.InvalidTokenError as exc:
        await audit_auth_refusal(audit, action, "system:anonymous", "invalid_token")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_token",
        ) from exc
    user = await store.get_user(str(claims["sub"]))
    if user is None or user.disabled:
        await audit_auth_refusal(audit, action, str(claims["sub"]), "invalid_user")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_user")
    return user


async def require_admin_2fa(
    user: UserRecord,
    settings: Settings,
    audit: AuditLogger,
    action: str,
    target: dict[str, str],
) -> None:
    """Require admin role and recent TOTP for sensitive PCAP operations."""

    if not user.is_admin():
        await audit_refusal(audit, user, action, target, "admin_required")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin_required")
    if not user.has_recent_totp(settings.totp_recent_minutes):
        await audit_refusal(audit, user, action, target, "totp_required")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="totp_required")


async def active_engagement_or_refuse(
    store: Store,
    audit: AuditLogger,
    user: UserRecord,
    engagement_id: str,
    action: str,
) -> Engagement:
    """Return an active engagement or audit and reject."""

    engagement = await engagement_or_refuse(store, audit, user, engagement_id, action)
    if engagement.ended_at is None:
        return engagement
    await audit_refusal(audit, user, action, {"engagement_id": engagement_id}, "inactive")
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="engagement_inactive")


async def engagement_or_refuse(
    store: Store,
    audit: AuditLogger,
    user: UserRecord,
    engagement_id: str,
    action: str,
) -> Engagement:
    """Return an engagement or audit and reject."""

    engagement = await store.get_engagement(engagement_id)
    if engagement is None:
        await audit_refusal(audit, user, action, {"engagement_id": engagement_id}, "not_found")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="engagement_not_found")
    return engagement


async def pcap_or_refuse(
    pcaps: Annotated[PcapStore, Depends(get_pcap_store)],
    audit: AuditLogger,
    user: UserRecord,
    engagement_id: str,
    pcap_id: str,
    action: str,
) -> Pcap:
    """Return an engagement-scoped PCAP or audit and reject."""

    pcap = await pcaps.get_pcap(engagement_id, pcap_id)
    if pcap is None:
        await audit_refusal(
            audit, user, action, {"engagement_id": engagement_id, "pcap_id": pcap_id}, "not_found"
        )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="pcap_not_found")
    return pcap


async def audit_refusal(
    audit: AuditLogger,
    user: UserRecord,
    action: str,
    target: dict[str, str],
    reason: str,
) -> None:
    """Append a PCAP refusal audit entry."""

    await audit.record(user.id, f"{action}.refused", target, {}, f"denied:{reason}")


async def audit_auth_refusal(
    audit: AuditLogger,
    action: str,
    actor_id: str,
    reason: str,
) -> None:
    """Append a PCAP authentication refusal audit entry."""

    await audit.record(actor_id, f"{action}.refused", {}, {}, f"denied:{reason}")


def pcap_target(pcap: Pcap) -> dict[str, str]:
    """Return a stable audit target for one PCAP."""

    return {"engagement_id": pcap.engagement_id, "pcap_id": pcap.id, "sha256": pcap.sha256}


def request_action(request: Request) -> str:
    """Resolve the PCAP audit action for a request."""

    return _request_action(request)


def _request_action(request: Request) -> str:
    path = request.url.path
    if request.method == "POST" and path.endswith("/analyze"):
        return "pcap.analyze.start"
    if request.method == "POST":
        return "pcap.upload"
    if request.method == "DELETE":
        return "pcap.delete"
    if path.endswith("/analysis"):
        return "pcap.analysis.read"
    if path.endswith("/findings"):
        return "pcap.findings.list"
    if re.search(r"/findings/[^/]+$", path):
        return "pcap.finding.read"
    if re.search(r"/pcaps/[^/]+$", path):
        return "pcap.read"
    return "pcap.list"


def _bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:]
    return None
