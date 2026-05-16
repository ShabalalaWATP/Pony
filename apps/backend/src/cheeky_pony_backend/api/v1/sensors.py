# SPDX-License-Identifier: AGPL-3.0-only
"""Sensor registration and lifecycle API routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from cheeky_pony_backend.dependencies import get_store, require_admin_2fa
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.infra.certificates import issue_sensor_certificate
from cheeky_pony_shared import ApiPage, Sensor, SensorCapability

router = APIRouter(prefix="/sensors", tags=["sensors"])


class SensorRegisterRequest(BaseModel):
    """Sensor registration payload."""

    id: str = Field(min_length=1, max_length=96)
    name: str = Field(min_length=1, max_length=128)
    tailnet_ip: str = Field(min_length=3, max_length=64)
    capabilities: list[SensorCapability] = Field(default_factory=list)
    version: str = Field(min_length=1, max_length=64)


class SensorRegisterResponse(BaseModel):
    """Sensor registration response with one-time client material."""

    sensor: Sensor
    client_certificate_pem: str
    client_private_key_pem: str
    ca_certificate_pem: str


@router.post("", response_model=SensorRegisterResponse)
async def register_sensor(
    payload: SensorRegisterRequest,
    _: Annotated[UserRecord, Depends(require_admin_2fa)],
    store: Annotated[Store, Depends(get_store)],
) -> SensorRegisterResponse:
    """Register a sensor and issue client certificate material.

    Args:
        payload: Sensor registration payload.
        _: Current admin with verified TOTP.
        store: Application store.

    Returns:
        Registered sensor and certificate bundle.
    """

    if await store.get_sensor(payload.id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="sensor_exists")
    sensor = Sensor(**payload.model_dump())
    await store.create_sensor(sensor)
    bundle = issue_sensor_certificate(sensor.id)
    return SensorRegisterResponse(
        sensor=sensor,
        client_certificate_pem=bundle.certificate_pem,
        client_private_key_pem=bundle.private_key_pem,
        ca_certificate_pem=bundle.ca_certificate_pem,
    )


@router.get("", response_model=ApiPage[Sensor])
async def list_sensors(
    _: Annotated[UserRecord, Depends(require_admin_2fa)],
    store: Annotated[Store, Depends(get_store)],
) -> ApiPage[Sensor]:
    """List sensors.

    Args:
        _: Current admin with verified TOTP.
        store: Application store.

    Returns:
        Paginated sensor list.
    """

    sensors = await store.list_sensors()
    return ApiPage[Sensor](items=sensors, total=len(sensors), limit=len(sensors) or 1, offset=0)


@router.get("/{sensor_id}", response_model=Sensor)
async def get_sensor(
    sensor_id: str,
    _: Annotated[UserRecord, Depends(require_admin_2fa)],
    store: Annotated[Store, Depends(get_store)],
) -> Sensor:
    """Return one sensor.

    Args:
        sensor_id: Sensor identifier.
        _: Current admin with verified TOTP.
        store: Application store.

    Returns:
        Sensor record.
    """

    sensor = await store.get_sensor(sensor_id)
    if sensor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="sensor_not_found")
    return sensor


@router.post("/{sensor_id}/revoke", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_sensor(
    sensor_id: str,
    _: Annotated[UserRecord, Depends(require_admin_2fa)],
    store: Annotated[Store, Depends(get_store)],
) -> None:
    """Revoke a sensor.

    Args:
        sensor_id: Sensor identifier.
        _: Current admin with verified TOTP.
        store: Application store.
    """

    await store.revoke_sensor(sensor_id)
