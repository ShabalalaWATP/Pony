# SPDX-License-Identifier: AGPL-3.0-only
"""Audit helpers for authentication routes."""

from __future__ import annotations

from typing import Any

from cheeky_pony_backend.domain.audit import AuditLogger
from cheeky_pony_backend.domain.users import UserRecord

ANONYMOUS_ACTOR = "system:auth"


async def audit_auth(
    audit: AuditLogger,
    action: str,
    outcome: str,
    email: str | None = None,
    actor: UserRecord | str | None = None,
    target_user_id: str | None = None,
    parameters: dict[str, Any] | None = None,
) -> None:
    """Record an authentication audit event without secret material."""

    target: dict[str, Any] = {}
    if email is not None:
        target["email"] = email.lower()
    if target_user_id is not None:
        target["user_id"] = target_user_id
    await audit.record(
        actor_id=_actor_id(actor),
        action=action,
        target=target,
        parameters=parameters or {},
        outcome=outcome,
    )


def _actor_id(actor: UserRecord | str | None) -> str:
    if isinstance(actor, UserRecord):
        return actor.id
    if isinstance(actor, str):
        return actor
    return ANONYMOUS_ACTOR
