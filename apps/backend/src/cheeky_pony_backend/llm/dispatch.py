# SPDX-License-Identifier: AGPL-3.0-only
"""Dispatch helpers for LLM insight background tasks."""

from __future__ import annotations

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import BackgroundTasks

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.llm.task_context import LlmTaskContext
from cheeky_pony_backend.workers.tasks import generate_engagement_summary_insight


async def dispatch_engagement_summary(
    background_tasks: BackgroundTasks,
    settings: Settings,
    context: LlmTaskContext,
    engagement_id: str,
) -> None:
    """Queue engagement-summary generation without blocking engagement end."""

    if not settings.llm_enabled:
        return
    if settings.env == "test" or settings.use_in_memory_store:
        background_tasks.add_task(
            generate_engagement_summary_insight,
            context.as_worker_context(),
            engagement_id,
        )
        return
    redis = await create_pool(RedisSettings.from_dsn(settings.redis_dsn))
    try:
        await redis.enqueue_job("generate_engagement_summary_insight", engagement_id)
    finally:
        await redis.close()
