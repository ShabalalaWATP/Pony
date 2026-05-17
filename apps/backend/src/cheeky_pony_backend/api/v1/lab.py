# SPDX-License-Identifier: AGPL-3.0-only
"""Gated active lab module command API routes."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status

from cheeky_pony_backend.config import Settings, get_settings
from cheeky_pony_backend.dependencies import (
    current_user,
    get_audit_logger,
    get_operator_broker,
    get_sensor_command_broker,
    get_store,
)
from cheeky_pony_backend.domain.active_gates import ActiveGateDeniedError, ActiveGateService
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.lab import (
    LabActiveCommand,
    LabModule,
    LabModuleStartRequest,
    LabModuleStartResponse,
    LabTarget,
    module_capability,
    sanitize_parameters,
    sensor_module_name,
)
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.infra.operator_broker import OperatorBroker
from cheeky_pony_backend.infra.sensor_command_broker import (
    LabCommandRecord,
    SensorCommandBroker,
    SensorCommandMetadata,
)
from cheeky_pony_shared import ApiPage, CommandKind, Sensor, SensorCapability, SensorCommand

router = APIRouter(prefix="/lab", tags=["lab"])


@router.get("/active", response_model=ApiPage[LabActiveCommand])
async def list_active_lab_commands(
    _: Annotated[UserRecord, Depends(current_user)],
    broker: Annotated[SensorCommandBroker, Depends(get_sensor_command_broker)],
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> ApiPage[LabActiveCommand]:
    """List active lab commands.

    Args:
        _: Current user.
        broker: Sensor command broker.
        limit: Page size.
        offset: Page offset.

    Returns:
        Paginated active lab commands.
    """

    records = sorted(
        await broker.list_lab_commands(), key=lambda item: item.started_at, reverse=True
    )
    items = [_record_to_public(record) for record in records[offset : offset + limit]]
    return ApiPage[LabActiveCommand](items=items, total=len(records), limit=limit, offset=offset)


@router.post(
    "/{module}/start",
    response_model=LabModuleStartResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def start_lab_module(
    module: LabModule,
    payload: LabModuleStartRequest,
    user: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
    command_broker: Annotated[SensorCommandBroker, Depends(get_sensor_command_broker)],
    operator_broker: Annotated[OperatorBroker, Depends(get_operator_broker)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> LabModuleStartResponse:
    """Start one gated active lab module.

    Args:
        module: Active lab module.
        payload: Start request payload.
        user: Current user.
        store: Application store.
        audit: Audit logger.
        command_broker: Sensor command broker.
        operator_broker: Operator broker.
        settings: Runtime settings.

    Returns:
        Accepted command identifier and start timestamp.
    """

    request_body = _request_body(module, payload)
    await _authorize(settings, store, audit, user, f"lab.{module}.start", payload, request_body)
    sensor = await _active_sensor_or_audit(store, payload.sensor_id, user, audit, request_body)
    await _require_module_capability(sensor.capabilities, module, user, audit, request_body)

    command_id = str(uuid4())
    started_at = datetime.now(tz=UTC)
    target = payload.target.model_dump(mode="json")
    audit_entry = await audit.record(
        user.id,
        f"lab.{module}.start",
        _audit_target(payload, command_id),
        request_body,
        "started",
        started_at=started_at,
    )
    record = LabCommandRecord(
        command_id=command_id,
        module=module.value,
        sensor_id=payload.sensor_id,
        engagement_id=payload.engagement_id,
        target=target,
        started_at=started_at,
        parameters=sanitize_parameters(payload.parameters),
    )
    await command_broker.start_lab_command(record)
    await command_broker.remember(_metadata(user, audit_entry.id, record, CommandKind.START_MODULE))
    await command_broker.send(payload.sensor_id, _start_command(command_id, module, payload))
    await operator_broker.broadcast(_lab_started(record))
    return LabModuleStartResponse(command_id=command_id, started_at=started_at)


@router.post("/{module}/stop/{command_id}", status_code=status.HTTP_204_NO_CONTENT)
async def stop_lab_module(
    module: LabModule,
    command_id: str,
    user: Annotated[UserRecord, Depends(current_user)],
    store: Annotated[Store, Depends(get_store)],
    audit: Annotated[AuditLogger, Depends(get_audit_logger)],
    command_broker: Annotated[SensorCommandBroker, Depends(get_sensor_command_broker)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> None:
    """Stop one gated active lab module.

    Args:
        module: Active lab module.
        command_id: Active lab command identifier.
        user: Current user.
        store: Application store.
        audit: Audit logger.
        command_broker: Sensor command broker.
        settings: Runtime settings.
    """

    record = await command_broker.get_lab_command(command_id)
    if record is None or record.module != module.value:
        await _audit_missing_command(audit, user, module, command_id)
        raise ActiveGateDeniedError(
            "active_command_not_found",
            "The active lab command was not found.",
        )
    payload = _payload_from_record(record)
    request_body = {"module": module.value, "command_id": command_id}
    await _authorize(settings, store, audit, user, f"lab.{module}.stop", payload, request_body)
    audit_entry = await audit.record(
        user.id,
        f"lab.{module}.stop",
        _record_target(record),
        request_body,
        "stop_requested",
        started_at=record.started_at,
    )
    await command_broker.remember(_metadata(user, audit_entry.id, record, CommandKind.STOP_MODULE))
    await command_broker.send(record.sensor_id, _stop_command(record))


async def _authorize(
    settings: Settings,
    store: Store,
    audit: AuditLogger,
    user: UserRecord,
    action: str,
    payload: LabModuleStartRequest,
    request_body: dict[str, Any],
) -> None:
    await ActiveGateService(settings, store, audit).authorize(
        user,
        action,
        payload.engagement_id,
        payload.target.kind,
        payload.target.value,
        request_body,
    )


async def _active_sensor_or_audit(
    store: Store,
    sensor_id: str,
    user: UserRecord,
    audit: AuditLogger,
    request_body: dict[str, Any],
) -> Sensor:
    sensor = await store.get_sensor(sensor_id)
    if sensor is None or sensor.revoked:
        await audit.record(
            user.id,
            "lab.start",
            {"sensor_id": sensor_id},
            request_body,
            "denied:sensor_not_found",
        )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="sensor_not_found")
    return sensor


async def _require_module_capability(
    capabilities: list[SensorCapability],
    module: LabModule,
    user: UserRecord,
    audit: AuditLogger,
    request_body: dict[str, Any],
) -> None:
    required = module_capability(module)
    if SensorCapability.ACTIVE_MODULES in capabilities and required in capabilities:
        return
    await audit.record(
        user.id,
        f"lab.{module}.start",
        {"module": module.value},
        request_body,
        "denied:capability_not_advertised",
    )
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="capability_not_advertised")


def _metadata(
    user: UserRecord,
    audit_id: str,
    record: LabCommandRecord,
    command: CommandKind,
) -> SensorCommandMetadata:
    return SensorCommandMetadata(
        command_id=record.command_id,
        sensor_id=record.sensor_id,
        command=command,
        actor_id=user.id,
        parameters=record.parameters,
        started_at=record.started_at,
        audit_id=audit_id,
        lab_module=record.module,
        engagement_id=record.engagement_id,
        target=record.target,
    )


def _start_command(
    command_id: str,
    module: LabModule,
    payload: LabModuleStartRequest,
) -> SensorCommand:
    return SensorCommand(
        id=command_id,
        kind=CommandKind.START_MODULE,
        parameters={
            "module": sensor_module_name(module),
            "engagement_id": payload.engagement_id,
            "target": payload.target.model_dump(mode="json"),
            "parameters": sanitize_parameters(payload.parameters),
        },
        lab_mode=True,
    )


def _stop_command(record: LabCommandRecord) -> SensorCommand:
    return SensorCommand(
        id=record.command_id,
        kind=CommandKind.STOP_MODULE,
        parameters={"module": sensor_module_name(record.module)},
        lab_mode=True,
    )


def _payload_from_record(record: LabCommandRecord) -> LabModuleStartRequest:
    return LabModuleStartRequest(
        sensor_id=record.sensor_id,
        engagement_id=record.engagement_id,
        target=LabTarget.model_validate(record.target),
        parameters=record.parameters,
    )


def _request_body(module: LabModule, payload: LabModuleStartRequest) -> dict[str, Any]:
    body = payload.model_dump(mode="json")
    body["module"] = module.value
    body["parameters"] = sanitize_parameters(payload.parameters)
    return body


def _audit_target(payload: LabModuleStartRequest, command_id: str) -> dict[str, Any]:
    return {
        "sensor_id": payload.sensor_id,
        "engagement_id": payload.engagement_id,
        "command_id": command_id,
        "target": payload.target.model_dump(mode="json"),
    }


def _record_target(record: LabCommandRecord) -> dict[str, Any]:
    return {
        "sensor_id": record.sensor_id,
        "engagement_id": record.engagement_id,
        "command_id": record.command_id,
        "target": record.target,
    }


def _lab_started(record: LabCommandRecord) -> dict[str, Any]:
    return {
        "kind": "lab.started",
        "command_id": record.command_id,
        "module": record.module,
        "target": record.target,
        "started_at": record.started_at.isoformat(),
    }


def _record_to_public(record: LabCommandRecord) -> LabActiveCommand:
    return LabActiveCommand(
        command_id=record.command_id,
        module=LabModule(record.module),
        sensor_id=record.sensor_id,
        engagement_id=record.engagement_id,
        target=LabTarget.model_validate(record.target),
        started_at=record.started_at,
    )


async def _audit_missing_command(
    audit: AuditLogger,
    user: UserRecord,
    module: LabModule,
    command_id: str,
) -> None:
    await audit.record(
        user.id,
        f"lab.{module}.stop",
        {"command_id": command_id},
        {"module": module.value, "command_id": command_id},
        "denied:active_command_not_found",
    )
