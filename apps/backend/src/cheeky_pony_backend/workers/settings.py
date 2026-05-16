# SPDX-License-Identifier: AGPL-3.0-only
"""arq worker settings."""

from __future__ import annotations

from arq.connections import RedisSettings

from cheeky_pony_backend.config import get_settings
from cheeky_pony_backend.workers.tasks import (
    batch_insert_events,
    enrich_oui_vendor,
    evaluate_alerts,
)


class WorkerSettings:
    """arq worker configuration."""

    functions = [batch_insert_events, enrich_oui_vendor, evaluate_alerts]
    redis_settings = RedisSettings.from_dsn(get_settings().redis_dsn)
