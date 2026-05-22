# SPDX-License-Identifier: AGPL-3.0-only
"""Device, access point, and event query API routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from cheeky_pony_backend.dependencies import current_user, get_oui_service, get_store
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

    vendor_resolved: str | None = None


class Client(ClientRecord):
    """Client response with derived presentation metadata."""

    vendor_resolved: str | None = None


@router.get("/access_points", response_model=ApiPage[AccessPoint])
async def list_access_points(
    _: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
    oui: Annotated[OuiService, Depends(get_oui_service)],
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
    return ApiPage[AccessPoint](
        items=[_serialize_access_point(item, oui) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/access_points/{bssid}", response_model=AccessPoint)
async def get_access_point(
    bssid: str,
    _: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
    oui: Annotated[OuiService, Depends(get_oui_service)],
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
    return _serialize_access_point(item, oui)


@router.get("/access_points/{bssid}/clients", response_model=ApiPage[Client])
async def list_access_point_clients(
    bssid: str,
    _: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
    oui: Annotated[OuiService, Depends(get_oui_service)],
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
        items=[_serialize_client(item, oui) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/devices", response_model=ApiPage[Client])
async def list_clients(
    _: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
    oui: Annotated[OuiService, Depends(get_oui_service)],
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
        items=[_serialize_client(item, oui) for item in items],
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
    return _serialize_client(item, oui)


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


def _serialize_access_point(ap: AccessPointRecord, oui: OuiService) -> AccessPoint:
    vendor = oui.lookup(ap.bssid)
    data = ap.model_dump()
    data["vendor_resolved"] = None if vendor is None else vendor.long_vendor
    if vendor is not None:
        data["vendor_oui"] = vendor.long_vendor
    return AccessPoint.model_validate(data)


def _serialize_client(client: ClientRecord, oui: OuiService) -> Client:
    vendor = oui.lookup(client.mac)
    data = client.model_dump()
    data["vendor_resolved"] = None if vendor is None else vendor.long_vendor
    if vendor is not None:
        data["vendor_oui"] = vendor.long_vendor
    return Client.model_validate(data)
