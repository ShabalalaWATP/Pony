# SPDX-License-Identifier: AGPL-3.0-only
"""Token cost estimation for LLM budget enforcement."""

from __future__ import annotations

from collections.abc import Mapping

from pydantic import BaseModel, ConfigDict, Field


class ModelPricing(BaseModel):
    """Per-token pricing represented in micro-cents."""

    model_config = ConfigDict(extra="forbid")

    input_micro_cents_per_token: int = Field(ge=0)
    output_micro_cents_per_token: int = Field(ge=0)


PRICING_TABLE: Mapping[str, ModelPricing] = {
    "gpt-4o-mini": ModelPricing(
        input_micro_cents_per_token=15,
        output_micro_cents_per_token=60,
    ),
}


def estimate_tokens(text: str) -> int:
    """Estimate tokens for budget preflight without external tokenizers."""

    return max(1, (len(text) + 3) // 4)


def estimate_completion_cost_micro_cents(
    model: str,
    *,
    input_tokens: int,
    output_tokens: int,
) -> int:
    """Return estimated cost for one completion in micro-cents."""

    pricing = PRICING_TABLE.get(model)
    if pricing is None:
        return 0
    return (
        input_tokens * pricing.input_micro_cents_per_token
        + output_tokens * pricing.output_micro_cents_per_token
    )


def budget_usd_to_micro_cents(value: float) -> int:
    """Convert a USD budget to integer micro-cents."""

    return int(round(value * 100_000_000))
