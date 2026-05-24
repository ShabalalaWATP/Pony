# SPDX-License-Identifier: AGPL-3.0-only
"""Worker context bundle for LLM insight tasks."""

from __future__ import annotations

from dataclasses import dataclass

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.infra.pcap_analysis_store import PcapAnalysisStore
from cheeky_pony_backend.infra.pcap_store import PcapStore
from cheeky_pony_backend.llm.budget import UsageLedger
from cheeky_pony_backend.llm.cache import InsightCache
from cheeky_pony_backend.llm.client import LlmClient
from cheeky_pony_backend.llm.prompts import PromptTemplates
from cheeky_pony_backend.llm.redactor import PromptRedactor
from cheeky_pony_backend.llm.runtime_flags import LlmRuntimeFlags


@dataclass(frozen=True)
class LlmTaskContext:
    """Objects needed to run an LLM worker task in-process."""

    settings: Settings
    store: Store
    pcap_store: PcapStore
    pcap_analysis_store: PcapAnalysisStore
    client: LlmClient
    cache: InsightCache
    ledger: UsageLedger
    redactor: PromptRedactor
    templates: PromptTemplates
    runtime_flags: LlmRuntimeFlags | None = None

    def as_worker_context(self) -> dict[str, object]:
        """Return the arq-compatible context dictionary used by task functions."""

        return {
            "settings": self.settings,
            "store": self.store,
            "pcap_store": self.pcap_store,
            "pcap_analysis_store": self.pcap_analysis_store,
            "llm_client": self.client,
            "insight_cache": self.cache,
            "usage_ledger": self.ledger,
            "prompt_redactor": self.redactor,
            "prompt_templates": self.templates,
            "runtime_flags": self.runtime_flags,
        }
