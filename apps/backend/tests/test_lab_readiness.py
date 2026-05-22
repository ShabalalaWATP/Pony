# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for pure lab-readiness checklist computation."""

from __future__ import annotations

from itertools import product

import pytest

from cheeky_pony_backend.domain.lab_readiness import LabReadinessInput, lab_readiness
from cheeky_pony_shared import ReadinessCheck, ReadinessCheckId


@pytest.mark.parametrize(
    ("lab_mode", "admin", "totp", "engagement", "ack", "allow_list"),
    product([False, True], repeat=6),
)
def test_lab_readiness_truth_table(
    lab_mode: bool,
    admin: bool,
    totp: bool,
    engagement: bool,
    ack: bool,
    allow_list: bool,
) -> None:
    """Every readiness input combination maps to stable statuses and ready."""

    result = lab_readiness(
        LabReadinessInput(
            lab_mode=lab_mode,
            admin_role=admin,
            totp_recent=totp,
            engagement_active=engagement,
            authorized_operator=ack,
            allow_list_nonempty=allow_list,
        )
    )
    statuses = _statuses(result.checks)

    assert result.ready is (lab_mode and admin and totp and engagement and ack and allow_list)
    assert statuses[ReadinessCheckId.LAB_MODE_ENV] == _status(lab_mode)
    assert statuses[ReadinessCheckId.ADMIN_ROLE] == _status(admin)
    assert statuses[ReadinessCheckId.TOTP_RECENT] == (
        "not_applicable" if not admin else _status(totp)
    )
    assert statuses[ReadinessCheckId.ENGAGEMENT_ACTIVE] == _status(engagement)
    assert statuses[ReadinessCheckId.AUTHORIZED_OPERATOR] == _status(ack)
    assert statuses[ReadinessCheckId.ALLOW_LIST_NONEMPTY] == (
        "not_applicable" if not engagement else _status(allow_list)
    )


def test_lab_readiness_checks_have_actionable_copy() -> None:
    """Each checklist item exposes the frontend labels and hints."""

    result = lab_readiness(
        LabReadinessInput(
            lab_mode=False,
            admin_role=False,
            totp_recent=False,
            engagement_active=False,
            authorized_operator=False,
            allow_list_nonempty=False,
        )
    )

    assert [check.id for check in result.checks] == list(ReadinessCheckId)
    assert all(check.label for check in result.checks)
    assert all(check.fix_hint for check in result.checks)


def _statuses(checks: list[ReadinessCheck]) -> dict[ReadinessCheckId, str]:
    return {check.id: check.status for check in checks}


def _status(value: bool) -> str:
    return "ok" if value else "missing"
