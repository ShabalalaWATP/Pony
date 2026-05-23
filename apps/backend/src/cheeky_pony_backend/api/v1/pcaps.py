# SPDX-License-Identifier: AGPL-3.0-only
"""PCAP upload, metadata, and lifecycle API routes."""

from __future__ import annotations

import re
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Annotated
from uuid import uuid4

import jwt
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field

from cheeky_pony_backend.config import Settings, get_settings
from cheeky_pony_backend.dependencies import (
    check_auth_rate_limit,
    get_audit_logger,
    get_pcap_store,
    get_store,
    get_token_service,
)
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.pcap_models import Pcap, PcapStatus
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.infra.pcap_store import PcapStore
from cheeky_pony_backend.pcap.validator import (
    PcapValidationError,
    ValidatedPcap,
    validate_pcap_bytes,
)
from cheeky_pony_backend.security import TokenService
from cheeky_pony_shared import ApiPage, Engagement

router = APIRouter(prefix="/engagements/{engagement_id}/pcaps", tags=["pcaps"])

_UPLOAD_CHUNK_BYTES = 1024 * 1024
_UNSAFE_FILENAME_CHARS = re.compile(r"[^A-Za-z0-9._ -]+")


class PcapDeleteRequest(BaseModel):
    """Typed-confirm body for PCAP deletion."""

    model_config = ConfigDict(extra="forbid")

    confirm: str = Field(min_length=1, max_length=128)


async def _pcap_user(
    request: Request,
    store: Annotated[Store, Depends(get_store)],
    tokens: Annotated[TokenService, Depends(get_token_service)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
) -> UserRecord:
    token = _bearer_token(request) or request.cookies.get("access_token")
    action = _request_action(request)
    if token is None:
        await _audit_auth_refusal(audit, action, "system:anonymous", "authentication_required")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="authentication_required",
        )
    try:
        claims = tokens.verify(token, "access")
    except jwt.InvalidTokenError as exc:
        await _audit_auth_refusal(audit, action, "system:anonymous", "invalid_token")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_token",
        ) from exc
    user = await store.get_user(str(claims["sub"]))
    if user is None or user.disabled:
        await _audit_auth_refusal(audit, action, str(claims["sub"]), "invalid_user")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_user")
    return user


@router.post(
    "",
    response_model=Pcap,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(check_auth_rate_limit)],
)
async def upload_pcap(
    engagement_id: str,
    file: Annotated[UploadFile, File()],
    user: Annotated[UserRecord, Depends(_pcap_user)],
    store: Annotated[Store, Depends(get_store)],
    pcaps: Annotated[PcapStore, Depends(get_pcap_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Pcap:
    """Upload a capture into an active engagement.

    Args:
        engagement_id: Engagement identifier.
        file: Multipart PCAP or PCAPNG file.
        user: Current authenticated user.
        store: Application store.
        pcaps: PCAP persistence adapter.
        audit: Audit logger.
        settings: Runtime settings.

    Returns:
        Persisted PCAP metadata.
    """

    await _require_admin_2fa(user, settings, audit, "pcap.upload", {"engagement_id": engagement_id})
    await _active_engagement_or_refuse(store, audit, user, engagement_id)
    filename = _sanitize_filename(file.filename)
    validated = await _validate_upload(file, settings, audit, user, engagement_id)
    try:
        pcap = await _persist_pcap(pcaps, engagement_id, user.id, filename, validated, file)
    except Exception as exc:
        await _audit_refusal(
            audit, user, "pcap.upload", {"engagement_id": engagement_id}, "storage_error"
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="pcap_storage_error",
        ) from exc
    await audit.record(
        user.id,
        "pcap.upload",
        {"engagement_id": engagement_id, "pcap_id": pcap.id},
        _pcap_audit_parameters(pcap),
        "ok",
    )
    return pcap


@router.get("", response_model=ApiPage[Pcap])
async def list_pcaps(
    engagement_id: str,
    user: Annotated[UserRecord, Depends(_pcap_user)],
    store: Annotated[Store, Depends(get_store)],
    pcaps: Annotated[PcapStore, Depends(get_pcap_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> ApiPage[Pcap]:
    """List capture uploads for one engagement."""

    await _engagement_or_refuse(store, audit, user, engagement_id, "pcap.list")
    items, total = await pcaps.list_pcaps(engagement_id, limit, offset)
    await audit.record(
        user.id,
        "pcap.list",
        {"engagement_id": engagement_id},
        {"audit_level": "debug", "limit": limit, "offset": offset, "returned": len(items)},
        "ok",
    )
    return ApiPage[Pcap](items=items, total=total, limit=limit, offset=offset)


@router.get("/{pcap_id}", response_model=Pcap)
async def get_pcap(
    engagement_id: str,
    pcap_id: str,
    user: Annotated[UserRecord, Depends(_pcap_user)],
    store: Annotated[Store, Depends(get_store)],
    pcaps: Annotated[PcapStore, Depends(get_pcap_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
) -> Pcap:
    """Return one engagement-scoped capture metadata record."""

    await _engagement_or_refuse(store, audit, user, engagement_id, "pcap.read")
    pcap = await _pcap_or_refuse(pcaps, audit, user, engagement_id, pcap_id, "pcap.read")
    await audit.record(user.id, "pcap.read", _pcap_target(pcap), {"audit_level": "debug"}, "ok")
    return pcap


@router.delete("/{pcap_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pcap(
    engagement_id: str,
    pcap_id: str,
    payload: PcapDeleteRequest,
    user: Annotated[UserRecord, Depends(_pcap_user)],
    store: Annotated[Store, Depends(get_store)],
    pcaps: Annotated[PcapStore, Depends(get_pcap_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> None:
    """Delete one uploaded capture after admin, TOTP, and typed confirmation."""

    await _require_admin_2fa(user, settings, audit, "pcap.delete", {"engagement_id": engagement_id})
    await _engagement_or_refuse(store, audit, user, engagement_id, "pcap.delete")
    pcap = await _pcap_or_refuse(pcaps, audit, user, engagement_id, pcap_id, "pcap.delete")
    if payload.confirm != pcap.filename_sanitized:
        await _audit_refusal(audit, user, "pcap.delete", _pcap_target(pcap), "confirm_mismatch")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="confirm_mismatch")
    await pcaps.delete_pcap(engagement_id, pcap_id)
    await audit.record(
        user.id, "pcap.delete", _pcap_target(pcap), _pcap_audit_parameters(pcap), "ok"
    )


async def _persist_pcap(
    pcaps: PcapStore,
    engagement_id: str,
    actor_id: str,
    filename: str,
    validated: ValidatedPcap,
    file: UploadFile,
) -> Pcap:
    pcap_id = str(uuid4())
    metadata: dict[str, object] = {"pcap_id": pcap_id, "engagement_id": engagement_id}
    gridfs_id = await pcaps.write_file(filename, _upload_chunks(file), metadata)
    pcap = Pcap(
        id=pcap_id,
        engagement_id=engagement_id,
        filename_sanitized=filename,
        size_bytes=validated.size_bytes,
        sha256=validated.sha256,
        magic=validated.magic,
        uploaded_by=actor_id,
        uploaded_at=datetime.now(tz=UTC),
        status=PcapStatus.UPLOADED,
        gridfs_id=gridfs_id,
    )
    try:
        return await pcaps.create_pcap(pcap)
    except Exception:
        await pcaps.delete_file(gridfs_id)
        raise


async def _validate_upload(
    file: UploadFile,
    settings: Settings,
    audit: AuditLogger,
    user: UserRecord,
    engagement_id: str,
) -> ValidatedPcap:
    max_bytes = settings.pcap_max_upload_mb * 1024 * 1024
    try:
        validated = await validate_pcap_bytes(_upload_chunks(file), max_bytes=max_bytes)
    except PcapValidationError as exc:
        await _audit_refusal(
            audit, user, "pcap.upload", {"engagement_id": engagement_id}, exc.reason
        )
        raise HTTPException(status_code=_validation_status(exc), detail=exc.reason) from exc
    await file.seek(0)
    return validated


async def _upload_chunks(file: UploadFile) -> AsyncIterator[bytes]:
    while chunk := await file.read(_UPLOAD_CHUNK_BYTES):
        yield chunk


async def _require_admin_2fa(
    user: UserRecord,
    settings: Settings,
    audit: AuditLogger,
    action: str,
    target: dict[str, str],
) -> None:
    if not user.is_admin():
        await _audit_refusal(audit, user, action, target, "admin_required")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin_required")
    if not user.has_recent_totp(settings.totp_recent_minutes):
        await _audit_refusal(audit, user, action, target, "totp_required")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="totp_required")


async def _active_engagement_or_refuse(
    store: Store,
    audit: AuditLogger,
    user: UserRecord,
    engagement_id: str,
) -> Engagement:
    engagement = await _engagement_or_refuse(store, audit, user, engagement_id, "pcap.upload")
    if engagement.ended_at is None:
        return engagement
    await _audit_refusal(audit, user, "pcap.upload", {"engagement_id": engagement_id}, "inactive")
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="engagement_inactive")


async def _engagement_or_refuse(
    store: Store,
    audit: AuditLogger,
    user: UserRecord,
    engagement_id: str,
    action: str,
) -> Engagement:
    engagement = await store.get_engagement(engagement_id)
    if engagement is None:
        await _audit_refusal(audit, user, action, {"engagement_id": engagement_id}, "not_found")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="engagement_not_found")
    return engagement


async def _pcap_or_refuse(
    pcaps: PcapStore,
    audit: AuditLogger,
    user: UserRecord,
    engagement_id: str,
    pcap_id: str,
    action: str,
) -> Pcap:
    pcap = await pcaps.get_pcap(engagement_id, pcap_id)
    if pcap is None:
        await _audit_refusal(
            audit, user, action, {"engagement_id": engagement_id, "pcap_id": pcap_id}, "not_found"
        )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="pcap_not_found")
    return pcap


async def _audit_refusal(
    audit: AuditLogger,
    user: UserRecord,
    action: str,
    target: dict[str, str],
    reason: str,
) -> None:
    await audit.record(user.id, f"{action}.refused", target, {}, f"denied:{reason}")


def _pcap_target(pcap: Pcap) -> dict[str, str]:
    return {"engagement_id": pcap.engagement_id, "pcap_id": pcap.id, "sha256": pcap.sha256}


def _pcap_audit_parameters(pcap: Pcap) -> dict[str, object]:
    return {
        "filename_sanitized": pcap.filename_sanitized,
        "magic": pcap.magic,
        "size_bytes": pcap.size_bytes,
    }


def _sanitize_filename(filename: str | None) -> str:
    leaf = (filename or "capture.pcap").replace("\\", "/").split("/")[-1]
    cleaned = _UNSAFE_FILENAME_CHARS.sub("_", leaf).strip(" .")
    return (cleaned or "capture.pcap")[:128]


def _validation_status(exc: PcapValidationError) -> int:
    if exc.reason == "size_limit_exceeded":
        return status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
    return status.HTTP_415_UNSUPPORTED_MEDIA_TYPE


async def _audit_auth_refusal(
    audit: AuditLogger,
    action: str,
    actor_id: str,
    reason: str,
) -> None:
    await audit.record(actor_id, f"{action}.refused", {}, {}, f"denied:{reason}")


def _request_action(request: Request) -> str:
    if request.method == "POST":
        return "pcap.upload"
    if request.method == "DELETE":
        return "pcap.delete"
    if re.search(r"/pcaps/[^/]+$", request.url.path):
        return "pcap.read"
    return "pcap.list"


def _bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:]
    return None
