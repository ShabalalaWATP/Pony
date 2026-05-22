# SPDX-License-Identifier: AGPL-3.0-only
"""Pure lab-readiness checklist computation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from cheeky_pony_shared import ReadinessCheck, ReadinessCheckId

CheckStatus = Literal["ok", "missing", "not_applicable"]
OK: CheckStatus = "ok"
MISSING: CheckStatus = "missing"
NOT_APPLICABLE: CheckStatus = "not_applicable"


@dataclass(frozen=True)
class LabReadinessInput:
    """Inputs needed to compute the lab-readiness checklist."""

    lab_mode: bool
    admin_role: bool
    totp_recent: bool
    engagement_active: bool
    authorized_operator: bool
    allow_list_nonempty: bool


@dataclass(frozen=True)
class LabReadiness:
    """Computed lab readiness summary."""

    ready: bool
    checks: list[ReadinessCheck]


def lab_readiness(inputs: LabReadinessInput) -> LabReadiness:
    """Build an operator-facing lab readiness checklist.

    Args:
        inputs: Current settings, user, and engagement gate facts.

    Returns:
        Ready boolean plus ordered checklist items.
    """

    checks = [
        _lab_mode_check(inputs.lab_mode),
        _admin_role_check(inputs.admin_role),
        _totp_check(inputs.admin_role, inputs.totp_recent),
        _engagement_check(inputs.engagement_active),
        _acknowledgement_check(inputs.authorized_operator),
        _allow_list_check(inputs.engagement_active, inputs.allow_list_nonempty),
    ]
    return LabReadiness(ready=all(check.status != MISSING for check in checks), checks=checks)


def _lab_mode_check(enabled: bool) -> ReadinessCheck:
    return ReadinessCheck(
        id=ReadinessCheckId.LAB_MODE_ENV,
        label="LAB_MODE=true in backend env",
        status=OK if enabled else MISSING,
        fix_hint="Set LAB_MODE=true and restart the backend.",
        fix_route="/settings/system",
    )


def _admin_role_check(is_admin: bool) -> ReadinessCheck:
    return ReadinessCheck(
        id=ReadinessCheckId.ADMIN_ROLE,
        label="Caller has admin role",
        status=OK if is_admin else MISSING,
        fix_hint="Ask an existing admin to grant the admin role.",
        fix_route="/settings/users",
    )


def _totp_check(is_admin: bool, recent_totp: bool) -> ReadinessCheck:
    if not is_admin:
        status = NOT_APPLICABLE
    else:
        status = OK if recent_totp else MISSING
    return ReadinessCheck(
        id=ReadinessCheckId.TOTP_RECENT,
        label="Recent TOTP verification",
        status=status,
        fix_hint="Re-verify TOTP from Settings -> Account.",
        fix_route="/settings/account",
    )


def _engagement_check(active: bool) -> ReadinessCheck:
    return ReadinessCheck(
        id=ReadinessCheckId.ENGAGEMENT_ACTIVE,
        label="An engagement is active",
        status=OK if active else MISSING,
        fix_hint="Create or resume an engagement.",
        fix_route="/engagements",
    )


def _acknowledgement_check(on_file: bool) -> ReadinessCheck:
    return ReadinessCheck(
        id=ReadinessCheckId.AUTHORIZED_OPERATOR,
        label="Authorized-operator acknowledgement on file",
        status=OK if on_file else MISSING,
        fix_hint="Type and accept the authorized-operator acknowledgement.",
        fix_route="/settings/system",
    )


def _allow_list_check(engagement_active: bool, allow_list_nonempty: bool) -> ReadinessCheck:
    if not engagement_active:
        status = NOT_APPLICABLE
    else:
        status = OK if allow_list_nonempty else MISSING
    return ReadinessCheck(
        id=ReadinessCheckId.ALLOW_LIST_NONEMPTY,
        label="Active engagement has at least one target",
        status=status,
        fix_hint="Add at least one target to the active engagement allow-list.",
        fix_route="/engagements",
    )
