# SPDX-License-Identifier: AGPL-3.0-only
"""Central active-operation authorization gates."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_shared import TargetKind

AUTHORIZED_OPERATOR_KIND = "authorized_operator"


class ActiveGateService:
    """Evaluates non-negotiable gates before active lab actions."""

    def __init__(self, settings: Settings, store: Store, audit_logger: AuditLogger) -> None:
        self._settings = settings
        self._store = store
        self._audit = audit_logger

    async def authorize(
        self,
        actor: UserRecord,
        action: str,
        engagement_id: str,
        target_kind: TargetKind,
        target_value: str,
        parameters: dict[str, Any],
    ) -> None:
        """Authorize an active operation or raise 403.

        Args:
            actor: Operator requesting the action.
            action: Active action name.
            engagement_id: Engagement identifier.
            target_kind: Target kind.
            target_value: Target value.
            parameters: Sanitized action parameters.

        Raises:
            HTTPException: When a required gate is missing.
        """

        reason = await self._failure_reason(engagement_id, target_kind, target_value)
        target = {"kind": target_kind.value, "value": target_value, "engagement_id": engagement_id}
        if reason is not None:
            await self._audit.record(actor.id, action, target, parameters, f"denied:{reason}")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=reason)
        await self._audit.record(actor.id, action, target, parameters, "authorized")

    async def _failure_reason(
        self,
        engagement_id: str,
        target_kind: TargetKind,
        target_value: str,
    ) -> str | None:
        if not self._settings.lab_mode:
            return "lab_mode_required"
        if not await self._store.has_acknowledgement(AUTHORIZED_OPERATOR_KIND):
            return "authorized_operator_acknowledgement_required"
        if not await self._store.target_allowed(engagement_id, target_kind, target_value):
            return "target_not_allow_listed"
        return None
