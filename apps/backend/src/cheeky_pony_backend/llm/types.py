# SPDX-License-Identifier: AGPL-3.0-only
"""Shared models for LLM insight generation."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

InsightKind = Literal["alert_context"]
InsightConfidence = Literal["low", "medium", "high"]
MessageRole = Literal["system", "user", "assistant"]


class ChatMessage(BaseModel):
    """OpenAI-compatible chat message."""

    model_config = ConfigDict(extra="forbid")

    role: MessageRole
    content: str = Field(min_length=1, max_length=32_000)


class LlmCompletion(BaseModel):
    """Validated completion returned by an LLM client."""

    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1, max_length=16_000)
    model: str = Field(min_length=1, max_length=128)
    tokens_input: int | None = Field(default=None, ge=0)
    tokens_output: int | None = Field(default=None, ge=0)


class Insight(BaseModel):
    """Operator-facing validated insight."""

    model_config = ConfigDict(extra="forbid")

    kind: InsightKind
    entity_id: str = Field(min_length=1, max_length=128)
    summary: str = Field(min_length=1, max_length=600)
    bullet_points: list[str] = Field(default_factory=list, max_length=5)
    confidence: InsightConfidence
    generated_at: datetime
    model: str = Field(min_length=1, max_length=128)
    template_version: str = Field(min_length=1, max_length=16)
    cached: bool = False

    @field_validator("bullet_points")
    @classmethod
    def validate_bullets(cls, value: list[str]) -> list[str]:
        """Reject overlong or empty bullet text."""

        if any(not item.strip() or len(item) > 160 for item in value):
            msg = "bullet_points must contain 1-160 character items"
            raise ValueError(msg)
        return value


class CachedInsight(BaseModel):
    """Mongo-stored insight cache record."""

    model_config = ConfigDict(extra="forbid")

    key: str = Field(min_length=1, max_length=256)
    kind: InsightKind
    entity_id: str = Field(min_length=1, max_length=128)
    prompt_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    template_version: str = Field(min_length=1, max_length=16)
    insight: Insight
    expires_at: datetime | None = None


class PromptTemplate(BaseModel):
    """Loaded versioned prompt template."""

    model_config = ConfigDict(extra="forbid")

    kind: InsightKind
    version: str = Field(min_length=1, max_length=16)
    content: str = Field(min_length=1)
