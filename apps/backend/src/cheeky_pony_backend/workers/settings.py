# SPDX-License-Identifier: AGPL-3.0-only
"""arq worker settings."""

from __future__ import annotations

from arq.connections import RedisSettings

from cheeky_pony_backend.config import get_settings
from cheeky_pony_backend.domain.oui_lookup import create_oui_service
from cheeky_pony_backend.infra.mongo_store import MongoStore
from cheeky_pony_backend.infra.pcap_analysis_store import MongoPcapAnalysisStore
from cheeky_pony_backend.infra.pcap_store import GridFsPcapStore
from cheeky_pony_backend.llm.budget import MongoUsageLedger
from cheeky_pony_backend.llm.cache import MongoInsightCache
from cheeky_pony_backend.llm.client import OpenAICompatibleClient
from cheeky_pony_backend.llm.prompts import PromptTemplates
from cheeky_pony_backend.llm.redactor import PromptRedactor
from cheeky_pony_backend.pcap.tshark import TsharkRuntime
from cheeky_pony_backend.workers.tasks import (
    analyze_pcap_capture,
    batch_insert_events,
    enrich_oui_vendor,
    evaluate_alerts,
    generate_alert_context_insight,
    generate_engagement_summary_insight,
)


async def startup(ctx: dict[str, object]) -> None:
    """Create worker-scoped stores and runtimes."""

    settings = get_settings()
    store = MongoStore(settings.mongo_dsn, settings.mongo_db)
    pcap_store = GridFsPcapStore(store.db)
    analysis_store = MongoPcapAnalysisStore(store.db)
    insight_cache = MongoInsightCache(store.db)
    usage_ledger = MongoUsageLedger(store.db)
    await store.ensure_indexes()
    await pcap_store.ensure_indexes()
    await analysis_store.ensure_indexes()
    await insight_cache.ensure_indexes()
    await usage_ledger.ensure_indexes()
    ctx["settings"] = settings
    ctx["store"] = store
    ctx["pcap_store"] = pcap_store
    ctx["pcap_analysis_store"] = analysis_store
    ctx["oui_service"] = create_oui_service()
    ctx["tshark_runtime"] = TsharkRuntime(settings)
    ctx["llm_client"] = OpenAICompatibleClient(settings)
    ctx["insight_cache"] = insight_cache
    ctx["usage_ledger"] = usage_ledger
    ctx["prompt_templates"] = PromptTemplates.load()
    ctx["prompt_redactor"] = PromptRedactor(
        redact_ssid=settings.llm_redact_ssid,
        redact_vendor=settings.llm_redact_vendor,
    )


class WorkerSettings:
    """arq worker configuration."""

    functions = [
        batch_insert_events,
        enrich_oui_vendor,
        evaluate_alerts,
        generate_alert_context_insight,
        generate_engagement_summary_insight,
        analyze_pcap_capture,
    ]
    on_startup = startup
    redis_settings = RedisSettings.from_dsn(get_settings().redis_dsn)
