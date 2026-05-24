# SPDX-License-Identifier: AGPL-3.0-only
"""Helpers for ending engagements and cancelling scoped lab commands."""

from __future__ import annotations

from datetime import UTC, datetime

from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.infra.operator_broker import OperatorBroker
from cheeky_pony_backend.infra.sensor_command_broker import LabCommandRecord, SensorCommandBroker
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


async def cancel_lab_records(
    records: list[LabCommandRecord],
    user: UserRecord,
    engagement_id: str,
    finished_at: datetime,
    audit: AuditLogger,
    command_broker: SensorCommandBroker,
    operator_broker: OperatorBroker,
) -> None:
    """Cancel active lab command records for an ending engagement."""

    for record in records:
        audit_entry = await audit.record(
            user.id,
            f"lab.{record.module}.stop",
            {"engagement_id": engagement_id, "command_id": record.command_id},
            {"reason": "engagement_ended"},
            "cancelled",
            started_at=record.started_at,
            finished_at=finished_at,
        )
        await command_broker.send(record.sensor_id, _stop_module_command(record))
        await operator_broker.broadcast(_stopped_payload(record, finished_at, audit_entry.id))


def _stop_module_command(record: LabCommandRecord) -> SensorCommand:
    return SensorCommand(
        id=record.command_id,
        kind=CommandKind.STOP_MODULE,
        parameters={"module": record.module.replace("-", "_")},
        lab_mode=True,
    )


def _stopped_payload(
    record: LabCommandRecord,
    finished_at: datetime,
    audit_id: str,
) -> dict[str, object]:
    return {
        "kind": "lab.stopped",
        "command_id": record.command_id,
        "module": record.module,
        "sensor_id": record.sensor_id,
        "outcome": "cancelled",
        "finished_at": finished_at.isoformat(),
        "audit_id": audit_id,
    }
