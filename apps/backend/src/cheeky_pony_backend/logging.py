# SPDX-License-Identifier: AGPL-3.0-only
"""Structured logging configuration for backend services."""

from __future__ import annotations

import logging

import structlog


def configure_logging() -> None:
    """Configure stdlib and structlog for JSON logs."""

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        cache_logger_on_first_use=True,
    )
