# SPDX-License-Identifier: AGPL-3.0-only
"""PCAP-finding insight prompt builder and response schema."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from cheeky_pony_backend.domain.ports import Store
from cheeky_pony_backend.infra.pcap_analysis_store import PcapAnalysisStore
from cheeky_pony_backend.llm.types import InsightConfidence
from cheeky_pony_backend.pcap.findings import Finding, redact_lab_gated_evidence

type JsonValue = str | int | float | bool | None | list[JsonValue] | dict[str, JsonValue]
_LAB_ONLY_EVIDENCE_KEYS = frozenset({"pmkid", "raw_bytes_b64"})
_PROMPT_KEY_RENAMES = {"handshakes": "eapol_observations"}


class PcapFindingResponse(BaseModel):
    """Validated model response for PCAP-finding insights."""

    model_config = ConfigDict(extra="forbid")

    summary: str = Field(min_length=1, max_length=600)
    bullet_points: list[str] = Field(default_factory=list, max_length=5)
    confidence: InsightConfidence


class PcapFindingEngagement(BaseModel):
    """Prompt-safe engagement context."""

    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    scope_rule_count: int = Field(ge=0)
    synthetic: bool


class PcapFindingMetadata(BaseModel):
    """Prompt-safe structured finding metadata."""

    model_config = ConfigDict(extra="forbid")

    evidence: dict[str, JsonValue]
    generated_at: datetime
    kind: str
    severity: str
    summary: str


class PcapFindingPromptContext(BaseModel):
    """Structured prompt context for one PCAP finding."""

    model_config = ConfigDict(extra="forbid")

    engagement: PcapFindingEngagement
    finding: PcapFindingMetadata


async def build_pcap_finding_context(
    store: Store,
    analysis_store: PcapAnalysisStore,
    finding_id: str,
) -> PcapFindingPromptContext | None:
    """Build deterministic structured context for one PCAP finding."""

    finding = await analysis_store.get_finding_by_id(finding_id)
    if finding is None:
        return None
    engagement = await store.get_engagement(finding.engagement_id)
    if engagement is None:
        return None
    return PcapFindingPromptContext(
        engagement=PcapFindingEngagement(
            id=engagement.id,
            name=engagement.name,
            scope_rule_count=len(engagement.scope_rules),
            synthetic=engagement.synthetic,
        ),
        finding=_finding_metadata(finding),
    )


def _finding_metadata(finding: Finding) -> PcapFindingMetadata:
    safe_finding = redact_lab_gated_evidence(finding, lab_mode=False)
    evidence = safe_finding.evidence.model_dump(mode="json", exclude_none=True)
    return PcapFindingMetadata(
        evidence=_scrub_evidence(evidence),
        generated_at=finding.generated_at,
        kind=finding.kind.value,
        severity=finding.severity.value,
        summary=finding.summary,
    )


def _scrub_evidence(value: object) -> dict[str, JsonValue]:
    scrubbed = _scrub_value(value)
    if isinstance(scrubbed, dict):
        return scrubbed
    return {}


def _scrub_value(value: object) -> JsonValue:
    if isinstance(value, dict):
        return _scrub_mapping(value)
    if isinstance(value, list | tuple | set):
        return [_scrub_value(item) for item in value]
    if value is None or isinstance(value, str | int | float | bool):
        return value
    return str(value)


def _scrub_mapping(value: dict[object, object]) -> dict[str, JsonValue]:
    scrubbed: dict[str, JsonValue] = {}
    for key, item in value.items():
        field = str(key)
        if field in _LAB_ONLY_EVIDENCE_KEYS:
            continue
        scrubbed[_PROMPT_KEY_RENAMES.get(field, field)] = _scrub_value(item)
    return scrubbed
