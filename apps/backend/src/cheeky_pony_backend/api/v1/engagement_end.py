# SPDX-License-Identifier: AGPL-3.0-only
"""Helpers for ending engagements and requesting scoped lab stops."""

from __future__ import annotations

from datetime import UTC, datetime

from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.infra.operator_broker import OperatorBroker
from cheeky_pony_backend.infra.sensor_command_broker import (
    LabCommandRecord,
    SensorCommandBroker,
    SensorCommandMetadata,
)
from cheeky_pony_shared import CommandKind, Engagement, SensorCommand


async def persist_engagement_end(
    store: Store,
    engagement: Engagement,
    should_update_end: bool,
) -> datetime:
    """Persist the engagement end timestamp, preserving idempotent replays."""

    ended_at = datetime.now(tz=UTC)
    persisted_ended_at = ended_at if should_update_end else engagement.ended_at
    if persisted_ended_at is None:
        persisted_ended_at = ended_at
    await store.update_engagement(engagement.model_copy(update={"ended_at": persisted_ended_at}))
    return persisted_ended_at


async def request_lab_record_stops(
    records: list[LabCommandRecord],
    user: UserRecord,
    engagement_id: str,
    finished_at: datetime,
    audit: AuditLogger,
    command_broker: SensorCommandBroker,
    operator_broker: OperatorBroker,
) -> None:
    """Request sensor stops without dropping active state before acknowledgement."""

    for record in records:
        audit_entry = await audit.record(
            user.id,
            f"lab.{record.module}.stop",
            {"engagement_id": engagement_id, "command_id": record.command_id},
            {"reason": "engagement_ended"},
            "stop_requested",
            started_at=record.started_at,
            finished_at=finished_at,
        )
        await command_broker.remember(_stop_metadata(user, audit_entry.id, record))
        await command_broker.send(record.sensor_id, _stop_module_command(record))
        await operator_broker.broadcast(_stop_requested_payload(record, audit_entry.id))


def _stop_metadata(
    user: UserRecord,
    audit_id: str,
    record: LabCommandRecord,
) -> SensorCommandMetadata:
    return SensorCommandMetadata(
        command_id=record.command_id,
        sensor_id=record.sensor_id,
        command=CommandKind.STOP_MODULE,
        actor_id=user.id,
        parameters=record.parameters,
        started_at=record.started_at,
        audit_id=audit_id,
        lab_module=record.module,
        engagement_id=record.engagement_id,
        target=record.target,
    )


def _stop_module_command(record: LabCommandRecord) -> SensorCommand:
    return SensorCommand(
        id=record.command_id,
        kind=CommandKind.STOP_MODULE,
        parameters={"module": record.module.replace("-", "_")},
        lab_mode=True,
    )


def _stop_requested_payload(
    record: LabCommandRecord,
    audit_id: str,
) -> dict[str, object]:
    return {
        "kind": "lab.progress",
        "command_id": record.command_id,
        "module": record.module,
        "sensor_id": record.sensor_id,
        "status": "stop_requested",
        "message": "Engagement ended; stop command queued.",
        "audit_id": audit_id,
    }
