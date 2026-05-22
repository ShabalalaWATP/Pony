# SPDX-License-Identifier: AGPL-3.0-only
"""Device, access point, and event query API routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import Field

from cheeky_pony_backend.api.v1.device_anomaly import (
    ANOMALY_AP_SCAN_LIMIT,
    AccessPointScoringContext,
    build_access_point_scoring_context,
    resolve_access_point_vendor,
    resolved_vendor_name,
    same_ssid_peers,
)
from cheeky_pony_backend.config import Settings, get_settings
from cheeky_pony_backend.dependencies import (
    current_user,
    get_audit_logger,
    get_oui_service,
    get_store,
)
from cheeky_pony_backend.domain.anomaly import (
    AnomalyContribution,
    EvilTwinCandidate,
    find_evil_twin_candidates,
    score_access_point,
)
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.labelling import (
    ApType,
    DeviceClass,
    classify_ap,
    classify_client,
    threshold_ap_label,
    threshold_client_label,
)
from cheeky_pony_backend.domain.oui_lookup import OuiService
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_shared import (
    AccessPoint as AccessPointRecord,
)
from cheeky_pony_shared import (
    ApiPage,
    Event,
)
from cheeky_pony_shared import (
    Client as ClientRecord,
)

router = APIRouter(tags=["devices"])


class AccessPoint(AccessPointRecord):
    """Access point response with derived presentation metadata."""

    anomaly_reasons: list[AnomalyContribution] = Field(default_factory=list)
    anomaly_score: int = Field(default=0, ge=0, le=100)
    label: ApType = ApType.UNKNOWN
    label_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    vendor_resolved: str | None = None


class Client(ClientRecord):
    """Client response with derived presentation metadata."""

    label: DeviceClass = DeviceClass.UNKNOWN
    label_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    vendor_resolved: str | None = None


@router.get("/access_points", response_model=ApiPage[AccessPoint])
async def list_access_points(
    _: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
    oui: Annotated[OuiService, Depends(get_oui_service)],
    settings: Annotated[Settings, Depends(get_settings)],
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> ApiPage[AccessPoint]:
    """List observed access points.

    Args:
        _: Current user.
        store: Application store.
        limit: Page size.
        offset: Page offset.

    Returns:
        Paginated access point list.
    """

    items, total = await store.list_access_points(limit, offset)
    scoring = await build_access_point_scoring_context(store, oui)
    return ApiPage[AccessPoint](
        items=[
            _serialize_access_point(item, oui, settings.label_confidence_threshold, scoring)
            for item in items
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/access_points/evil-twin-candidates", response_model=ApiPage[EvilTwinCandidate])
async def list_evil_twin_candidates(
    user: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
    oui: Annotated[OuiService, Depends(get_oui_service)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> ApiPage[EvilTwinCandidate]:
    """List same-SSID vendor mismatch candidates for operator review.

    Args:
        user: Current user.
        store: Application store.
        oui: OUI lookup service.
        audit: Audit logger.
        limit: Page size.
        offset: Page offset.

    Returns:
        Paginated evil-twin candidate list.
    """

    access_points, _ = await store.list_access_points(ANOMALY_AP_SCAN_LIMIT, 0)
    candidates = find_evil_twin_candidates(
        [resolve_access_point_vendor(access_point, oui) for access_point in access_points]
    )
    page = candidates[offset : offset + limit]
    await audit.record(
        user.id,
        "access_points.evil_twin_candidates.read",
        {},
        {"audit_level": "debug", "limit": limit, "offset": offset, "returned": len(page)},
        "ok",
    )
    return ApiPage[EvilTwinCandidate](items=page, total=len(candidates), limit=limit, offset=offset)


@router.get("/access_points/{bssid}", response_model=AccessPoint)
async def get_access_point(
    bssid: str,
    _: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
    oui: Annotated[OuiService, Depends(get_oui_service)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AccessPoint:
    """Return one access point.

    Args:
        bssid: BSSID.
        _: Current user.
        store: Application store.

    Returns:
        Access point.
    """

    item = await store.get_access_point(bssid)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="access_point_not_found")
    scoring = await build_access_point_scoring_context(store, oui)
    return _serialize_access_point(item, oui, settings.label_confidence_threshold, scoring)


@router.get("/access_points/{bssid}/clients", response_model=ApiPage[Client])
async def list_access_point_clients(
    bssid: str,
    _: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
    oui: Annotated[OuiService, Depends(get_oui_service)],
    settings: Annotated[Settings, Depends(get_settings)],
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> ApiPage[Client]:
    """List client devices associated with one access point.

    Args:
        bssid: Access point BSSID.
        _: Current user.
        store: Application store.
        limit: Page size.
        offset: Page offset.

    Returns:
        Paginated associated client list.
    """

    items, total = await store.list_clients_for_access_point(bssid, limit, offset)
    return ApiPage[Client](
        items=[_serialize_client(item, oui, settings.label_confidence_threshold) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/devices", response_model=ApiPage[Client])
async def list_clients(
    _: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
    oui: Annotated[OuiService, Depends(get_oui_service)],
    settings: Annotated[Settings, Depends(get_settings)],
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> ApiPage[Client]:
    """List observed client devices.

    Args:
        _: Current user.
        store: Application store.
        limit: Page size.
        offset: Page offset.

    Returns:
        Paginated client list.
    """

    items, total = await store.list_clients(limit, offset)
    return ApiPage[Client](
        items=[_serialize_client(item, oui, settings.label_confidence_threshold) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/devices/{mac}", response_model=Client)
async def get_client(
    mac: str,
    _: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
    oui: Annotated[OuiService, Depends(get_oui_service)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Client:
    """Return one client device.

    Args:
        mac: Client MAC.
        _: Current user.
        store: Application store.

    Returns:
        Client device.
    """

    item = await store.get_client(mac)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="client_not_found")
    return _serialize_client(item, oui, settings.label_confidence_threshold)


@router.get("/events", response_model=ApiPage[Event])
async def list_events(
    _: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> ApiPage[Event]:
    """List events.

    Args:
        _: Current user.
        store: Application store.
        limit: Page size.
        offset: Page offset.

    Returns:
        Paginated event list.
    """

    items, total = await store.list_events(limit, offset)
    return ApiPage[Event](items=items, total=total, limit=limit, offset=offset)


@router.get("/events/{event_id}", response_model=Event)
async def get_event(
    event_id: str,
    _: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
) -> Event:
    """Return one event.

    Args:
        event_id: Event identifier.
        _: Current user.
        store: Application store.

    Returns:
        Event.
    """

    item = await store.get_event(event_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="event_not_found")
    return item


def _serialize_access_point(
    ap: AccessPointRecord,
    oui: OuiService,
    label_confidence_threshold: float,
    scoring: AccessPointScoringContext,
) -> AccessPoint:
    ap_for_analysis = resolve_access_point_vendor(ap, oui)
    data = ap_for_analysis.model_dump()
    data["vendor_resolved"] = resolved_vendor_name(ap.bssid, oui)
    classification = threshold_ap_label(classify_ap(ap_for_analysis), label_confidence_threshold)
    anomaly_score, reasons = score_access_point(
        ap_for_analysis,
        same_ssid_peers=same_ssid_peers(ap_for_analysis, scoring.access_points),
        recent_deauths=scoring.recent_deauths.get(ap_for_analysis.bssid.upper(), 0),
        associated_client_count=scoring.associated_clients.get(ap_for_analysis.bssid.upper(), 0),
    )
    data["anomaly_score"] = anomaly_score
    data["anomaly_reasons"] = reasons
    data["label"] = classification.label
    data["label_confidence"] = classification.confidence
    return AccessPoint.model_validate(data)


def _serialize_client(
    client: ClientRecord,
    oui: OuiService,
    label_confidence_threshold: float,
) -> Client:
    vendor = oui.lookup(client.mac)
    data = client.model_dump()
    data["vendor_resolved"] = None if vendor is None else vendor.long_vendor
    if vendor is not None:
        data["vendor_oui"] = vendor.long_vendor
    client_for_label = ClientRecord.model_validate(
        {key: value for key, value in data.items() if key != "vendor_resolved"}
    )
    classification = threshold_client_label(
        classify_client(client_for_label, client_for_label.probes),
        label_confidence_threshold,
    )
    data["label"] = classification.label
    data["label_confidence"] = classification.confidence
    return Client.model_validate(data)
