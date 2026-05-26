# SPDX-License-Identifier: AGPL-3.0-only
"""Sensor registration and lifecycle API routes."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator

from cheeky_pony_backend.dependencies import (
    get_audit_logger,
    get_sensor_command_broker,
    get_store,
    require_admin_2fa,
)
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.infra.certificates import issue_sensor_certificate
from cheeky_pony_backend.infra.sensor_command_broker import (
    SensorCommandBroker,
    SensorCommandMetadata,
)
from cheeky_pony_shared import ApiPage, CommandKind, Sensor, SensorCapability, SensorCommand

router = APIRouter(prefix="/sensors", tags=["sensors"])
WS_SCHEME = "ws" + "://"
WSS_SCHEME = "wss" + "://"


class SensorRegisterRequest(BaseModel):
    """Sensor registration payload."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=96)
    name: str = Field(min_length=1, max_length=128)
    tailnet_ip: str = Field(min_length=3, max_length=64)
    capabilities: list[SensorCapability] = Field(default_factory=list)
    version: str = Field(min_length=1, max_length=64)
    backend_ws_url: str | None = Field(default=None, min_length=1, max_length=512)

    @field_validator("backend_ws_url")
    @classmethod
    def validate_backend_ws_url(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith((WS_SCHEME, WSS_SCHEME)):
            msg = f"backend_ws_url must start with {WS_SCHEME} or {WSS_SCHEME}"
            raise ValueError(msg)
        return value


class SensorRegisterResponse(BaseModel):
    """Sensor registration response with one-time client material."""

    sensor: Sensor
    client_certificate_pem: str
    client_private_key_pem: str
    ca_certificate_pem: str
    sensor_toml: str


class SensorCommandAcceptedResponse(BaseModel):
    """Sensor command acceptance response."""

    command_id: str


class SetChannelRequest(BaseModel):
    """Set-channel command body."""

    model_config = ConfigDict(extra="forbid")

    channel: int = Field(ge=1, le=196)
    band: Literal["2.4", "5", "6"]


@router.post("", response_model=SensorRegisterResponse)
async def register_sensor(
    payload: SensorRegisterRequest,
    user: Annotated[UserRecord, Depends(require_admin_2fa)],
    store: Annotated[Store, Depends(get_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
) -> SensorRegisterResponse:
    """Register a sensor and issue client certificate material.

    Args:
        payload: Sensor registration payload.
        user: Current admin with verified TOTP.
        store: Application store.
        audit: Audit logger.

    Returns:
        Registered sensor and certificate bundle.
    """

    if await store.get_sensor(payload.id):
        await audit.record(
            user.id,
            "sensor.register",
            {"sensor_id": payload.id},
            {"name": payload.name, "tailnet_ip": payload.tailnet_ip},
            "denied:sensor_exists",
        )
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="sensor_exists")
    bundle = issue_sensor_certificate(payload.id)
    sensor_payload = payload.model_dump(exclude={"backend_ws_url"})
    sensor = Sensor(
        **sensor_payload,
        client_cert_fingerprint_sha256=bundle.fingerprint_sha256,
    )
    await store.create_sensor(sensor)
    await audit.record(
        user.id,
        "sensor.register",
        {"sensor_id": sensor.id},
        {"name": sensor.name, "tailnet_ip": sensor.tailnet_ip},
        "ok",
    )
    return SensorRegisterResponse(
        sensor=sensor,
        client_certificate_pem=bundle.certificate_pem,
        client_private_key_pem=bundle.private_key_pem,
        ca_certificate_pem=bundle.ca_certificate_pem,
        sensor_toml=_sensor_toml(payload),
    )


def _sensor_toml(payload: SensorRegisterRequest) -> str:
    backend_line = (
        f"backend_ws_url = {_toml_string(payload.backend_ws_url)}"
        if payload.backend_ws_url
        else '# backend_ws_url = "wss://<backend-tailnet-host>/ws/sensor-gateway"'
    )
    return "\n".join(
        [
            f"sensor_id = {_toml_string(payload.id)}",
            f"sensor_name = {_toml_string(payload.name)}",
            backend_line,
            'client_cert_path = "/etc/cheeky-pony/client.crt"',
            'client_key_path = "/etc/cheeky-pony/client.key"',
            'ca_cert_path = "/etc/cheeky-pony/ca.crt"',
            "manage_kismet = true",
            "",
        ]
    )


def _toml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


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
    user: Annotated[UserRecord, Depends(require_admin_2fa)],
    store: Annotated[Store, Depends(get_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
) -> None:
    """Revoke a sensor.

    Args:
        sensor_id: Sensor identifier.
        user: Current admin with verified TOTP.
        store: Application store.
        audit: Audit logger.
    """

    sensor = await store.get_sensor(sensor_id)
    if sensor is None:
        await audit.record(
            user.id, "sensor.revoke", {"sensor_id": sensor_id}, {}, "denied:not_found"
        )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="sensor_not_found")
    await store.revoke_sensor(sensor_id)
    await audit.record(user.id, "sensor.revoke", {"sensor_id": sensor_id}, {}, "ok")


@router.post(
    "/{sensor_id}/commands/restart",
    response_model=SensorCommandAcceptedResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def restart_sensor(
    sensor_id: str,
    user: Annotated[UserRecord, Depends(require_admin_2fa)],
    store: Annotated[Store, Depends(get_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
    broker: Annotated[SensorCommandBroker, Depends(get_sensor_command_broker)],
) -> SensorCommandAcceptedResponse:
    """Queue a sensor restart command.

    Args:
        sensor_id: Sensor identifier.
        user: Current admin with verified TOTP.
        store: Application store.
        audit: Audit logger.
        broker: Sensor command broker.

    Returns:
        Accepted command identifier.
    """

    return await _dispatch_sensor_command(
        sensor_id, CommandKind.RESTART, {}, user, store, audit, broker
    )


@router.post(
    "/{sensor_id}/commands/update",
    response_model=SensorCommandAcceptedResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def update_sensor_agent(
    sensor_id: str,
    user: Annotated[UserRecord, Depends(require_admin_2fa)],
    store: Annotated[Store, Depends(get_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
    broker: Annotated[SensorCommandBroker, Depends(get_sensor_command_broker)],
) -> SensorCommandAcceptedResponse:
    """Queue a sensor update command.

    Args:
        sensor_id: Sensor identifier.
        user: Current admin with verified TOTP.
        store: Application store.
        audit: Audit logger.
        broker: Sensor command broker.

    Returns:
        Accepted command identifier.
    """

    return await _dispatch_sensor_command(
        sensor_id, CommandKind.UPDATE, {}, user, store, audit, broker
    )


@router.post(
    "/{sensor_id}/commands/set-channel",
    response_model=SensorCommandAcceptedResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def set_sensor_channel(
    sensor_id: str,
    payload: SetChannelRequest,
    user: Annotated[UserRecord, Depends(require_admin_2fa)],
    store: Annotated[Store, Depends(get_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
    broker: Annotated[SensorCommandBroker, Depends(get_sensor_command_broker)],
) -> SensorCommandAcceptedResponse:
    """Queue a sensor channel-change command.

    Args:
        sensor_id: Sensor identifier.
        payload: Channel payload.
        user: Current admin with verified TOTP.
        store: Application store.
        audit: Audit logger.
        broker: Sensor command broker.

    Returns:
        Accepted command identifier.
    """

    parameters = payload.model_dump(mode="json")
    return await _dispatch_sensor_command(
        sensor_id,
        CommandKind.SET_CHANNEL,
        parameters,
        user,
        store,
        audit,
        broker,
    )


async def _dispatch_sensor_command(
    sensor_id: str,
    command_kind: CommandKind,
    parameters: dict[str, object],
    user: UserRecord,
    store: Store,
    audit: AuditLogger,
    broker: SensorCommandBroker,
) -> SensorCommandAcceptedResponse:
    action = f"sensors.commands.{command_kind.value}"
    sensor = await store.get_sensor(sensor_id)
    if sensor is None or sensor.revoked:
        await audit.record(
            user.id,
            action,
            {"sensor_id": sensor_id},
            parameters,
            "denied:not_found",
        )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="sensor_not_found")
    if (
        command_kind == CommandKind.SET_CHANNEL
        and SensorCapability.CHANNEL_CONTROL not in sensor.capabilities
    ):
        await audit.record(
            user.id,
            action,
            {"sensor_id": sensor_id},
            parameters,
            "denied:capability_not_advertised",
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="capability_not_advertised"
        )

    command_id = str(uuid4())
    started_at = datetime.now(tz=UTC)
    audit_entry = await audit.record(
        user.id,
        action,
        {"sensor_id": sensor_id, "command_id": command_id},
        parameters,
        "queued",
        started_at=started_at,
    )
    await broker.remember(
        SensorCommandMetadata(
            command_id=command_id,
            sensor_id=sensor_id,
            command=command_kind,
            actor_id=user.id,
            parameters=parameters,
            started_at=started_at,
            audit_id=audit_entry.id,
        )
    )
    await broker.send(
        sensor_id, SensorCommand(id=command_id, kind=command_kind, parameters=parameters)
    )
    return SensorCommandAcceptedResponse(command_id=command_id)
