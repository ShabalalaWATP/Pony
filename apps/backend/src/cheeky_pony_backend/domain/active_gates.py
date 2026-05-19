# SPDX-License-Identifier: AGPL-3.0-only
"""Central active-operation authorization gates."""

from __future__ import annotations

from typing import Any

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_shared import TargetKind

AUTHORIZED_OPERATOR_KIND = "authorized_operator"


class ActiveGateDeniedError(Exception):
    """Structured active-operation gate refusal."""

    def __init__(self, reason: str, detail: str) -> None:
        self.reason = reason
        self.detail = detail
        super().__init__(reason)


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
        """Authorize an active operation or raise a structured denial.

        Args:
            actor: Operator requesting the action.
            action: Active action name.
            engagement_id: Engagement identifier.
            target_kind: Target kind.
            target_value: Target value.
            parameters: Sanitized action parameters.

        Raises:
            ActiveGateDeniedError: When a required gate is missing.
        """

        reason = await self._failure_reason(actor, engagement_id, target_kind, target_value)
        target = {"kind": target_kind.value, "value": target_value, "engagement_id": engagement_id}
        if reason is not None:
            await self._audit.record(actor.id, action, target, parameters, f"denied:{reason}")
            raise ActiveGateDeniedError(reason, _reason_detail(reason))

    async def _failure_reason(
        self,
        actor: UserRecord,
        engagement_id: str,
        target_kind: TargetKind,
        target_value: str,
    ) -> str | None:
        try:
            if not self._settings.lab_mode:
                return "lab_mode_disabled"
            if not await self._store.has_acknowledgement(AUTHORIZED_OPERATOR_KIND):
                return "no_acknowledgement"
            if not actor.is_admin():
                return "admin_required"
            if not actor.has_recent_totp(self._settings.totp_recent_minutes):
                return "missing_2fa"
            engagement = await self._store.get_engagement(engagement_id)
            if engagement is None or engagement.ended_at is not None:
                return "no_active_engagement"
            if not await self._store.target_allowed(engagement_id, target_kind, target_value):
                return "target_not_in_allowlist"
        except Exception:
            return "gate_error"
        return None


def _reason_detail(reason: str) -> str:
    details = {
        "lab_mode_disabled": "LAB_MODE must be enabled before active lab actions can run.",
        "no_acknowledgement": "The authorized-operator acknowledgement has not been accepted.",
        "admin_required": "The current user must have the admin role.",
        "missing_2fa": "A recent TOTP verification is required.",
        "no_active_engagement": "The requested engagement is not active.",
        "target_not_in_allowlist": "The requested target is not in the engagement allow-list.",
        "gate_error": "The gate stack failed closed.",
        "active_command_not_found": "The active lab command was not found.",
    }
    return details.get(reason, "The active lab action was refused.")
