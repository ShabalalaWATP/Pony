# SPDX-License-Identifier: AGPL-3.0-only
"""Versioned prompt-template loading."""

from __future__ import annotations

from pathlib import Path

from cheeky_pony_backend.llm.types import InsightKind, PromptTemplate

_PROMPT_KINDS: tuple[InsightKind, ...] = ("alert_context",)


class PromptTemplates:
    """Fail-fast loader for checked-in prompt templates."""

    def __init__(self, templates: dict[tuple[InsightKind, str], PromptTemplate]) -> None:
        self._templates = templates

    @classmethod
    def load(cls, *, version: str = "v1") -> PromptTemplates:
        """Load all templates for a version from package resources."""

        templates: dict[tuple[InsightKind, str], PromptTemplate] = {}
        prompt_dir = Path(__file__).resolve().parent / version
        for kind in _PROMPT_KINDS:
            content = prompt_dir.joinpath(f"{kind}.txt").read_text(encoding="utf-8")
            templates[(kind, version)] = PromptTemplate(
                kind=kind,
                version=version,
                content=content,
            )
        return cls(templates)

    def get(self, kind: InsightKind, *, version: str = "v1") -> PromptTemplate:
        """Return a loaded template."""

        return self._templates[(kind, version)]
