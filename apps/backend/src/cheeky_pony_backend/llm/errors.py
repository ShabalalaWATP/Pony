# SPDX-License-Identifier: AGPL-3.0-only
"""Typed LLM insight errors."""

from __future__ import annotations

from typing import Literal

UnavailableReason = Literal["disabled", "budget_exceeded", "client_error", "validation_failed"]


class LlmInsightUnavailableError(Exception):
    """Raised when an insight cannot be generated safely."""

    def __init__(self, reason: UnavailableReason) -> None:
        super().__init__(reason)
        self.reason = reason


class LlmBudgetExceededError(LlmInsightUnavailableError):
    """Raised when the monthly budget would be exceeded."""

    def __init__(self) -> None:
        super().__init__("budget_exceeded")


class LlmClientError(LlmInsightUnavailableError):
    """Raised when the configured LLM endpoint fails."""

    def __init__(self) -> None:
        super().__init__("client_error")


class LlmOutputValidationError(LlmInsightUnavailableError):
    """Raised when a model response fails the expected schema."""

    def __init__(self) -> None:
        super().__init__("validation_failed")


class LlmEntityNotFoundError(Exception):
    """Raised when the source entity for an insight is not visible."""
