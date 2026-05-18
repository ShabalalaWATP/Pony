# SPDX-License-Identifier: AGPL-3.0-only
"""Audit logging service for privileged and active operations."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import uuid4

from cheeky_pony_backend.domain.lab import sanitize_parameters
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_shared import AuditLog


class AuditLogger:
    """Append-only audit logging boundary."""

    def __init__(self, store: Store) -> None:
        self._store = store

    async def record(
        self,
        actor_id: str,
        action: str,
        target: dict[str, Any],
        parameters: dict[str, Any],
        outcome: str,
        started_at: datetime | None = None,
        finished_at: datetime | None = None,
        raw_tool_output_ref: str | None = None,
    ) -> AuditLog:
        """Append one audit entry.

        Args:
            actor_id: Operator or system actor id.
            action: Action name.
            target: Target description.
            parameters: Sanitized action parameters.
            outcome: Result outcome.
            started_at: Optional action start timestamp.
            finished_at: Optional action finish timestamp.
            raw_tool_output_ref: Optional raw output reference.

        Returns:
            Persisted audit log.
        """

        entry = AuditLog(
            id=str(uuid4()),
            actor_id=actor_id,
            action=action,
            target=target,
            parameters=sanitize_parameters(parameters),
            outcome=outcome,
            started_at=started_at,
            finished_at=finished_at,
            raw_tool_output_ref=raw_tool_output_ref,
        )
        return await self._store.append_audit(entry)
