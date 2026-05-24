# SPDX-License-Identifier: AGPL-3.0-only
"""Prompt redaction for LLM trust-boundary crossings."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from string import ascii_uppercase
from typing import Final

from pydantic import BaseModel

_MAC_RE: Final[re.Pattern[str]] = re.compile(
    r"\b(?:[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}|"
    r"[0-9A-Fa-f]{2}(?:-[0-9A-Fa-f]{2}){5}|"
    r"[0-9A-Fa-f]{12})\b"
)
_SENSITIVE_KEY_RE: Final[re.Pattern[str]] = re.compile(
    r"password|credential|secret|token|key|handshake|code|otp",
    re.IGNORECASE,
)
_DROP_KEY_RE: Final[re.Pattern[str]] = re.compile(
    r"probe.*payload|payload.*probe|audit.*actor|actor_id",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class RedactionResult:
    """Redacted prompt payload and token replacement map."""

    text: str
    replacements: dict[str, str]


@dataclass
class _RedactionContext:
    redact_ssid: bool
    redact_vendor: bool
    replacements: dict[str, str] = field(default_factory=dict)
    type_counts: dict[str, int] = field(default_factory=dict)
    ssid_tokens: dict[str, str] = field(default_factory=dict)
    vendor_tokens: dict[str, str] = field(default_factory=dict)


class _DropValue:
    pass


_DROP = _DropValue()


class PromptRedactor:
    """Redact identifiers and sensitive fields before prompt construction."""

    def __init__(self, *, redact_ssid: bool = False, redact_vendor: bool = False) -> None:
        self._redact_ssid = redact_ssid
        self._redact_vendor = redact_vendor

    def redact(self, value: object) -> RedactionResult:
        """Return deterministic redacted JSON for a structured prompt context."""

        ctx = _RedactionContext(self._redact_ssid, self._redact_vendor)
        redacted = _redact_value(value, "", ctx)
        payload = {} if isinstance(redacted, _DropValue) else redacted
        text = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        return RedactionResult(text=text, replacements=dict(ctx.replacements))


def _redact_value(value: object, key_hint: str, ctx: _RedactionContext) -> object:
    if isinstance(value, BaseModel):
        return _redact_value(value.model_dump(mode="json"), key_hint, ctx)
    if isinstance(value, dict):
        return _redact_mapping(value, key_hint, ctx)
    if isinstance(value, list | tuple | set):
        return _redact_sequence(value, key_hint, ctx)
    if isinstance(value, str):
        return _redact_string(value, key_hint, ctx)
    if isinstance(value, datetime | date):
        return value.isoformat()
    if value is None or isinstance(value, bool | int | float):
        return value
    return _redact_string(str(value), key_hint, ctx)


def _redact_mapping(
    value: dict[object, object],
    key_hint: str,
    ctx: _RedactionContext,
) -> dict[str, object]:
    redacted: dict[str, object] = {}
    for raw_key, raw_value in value.items():
        key = str(raw_key)
        if _should_drop_key(key):
            continue
        nested = _redact_value(raw_value, f"{key_hint}.{key}".strip("."), ctx)
        if not isinstance(nested, _DropValue):
            redacted[key] = nested
    return redacted


def _redact_sequence(
    value: list[object] | tuple[object, ...] | set[object], key_hint: str, ctx: _RedactionContext
) -> list[object]:
    redacted: list[object] = []
    for item in value:
        nested = _redact_value(item, key_hint, ctx)
        if not isinstance(nested, _DropValue):
            redacted.append(nested)
    return redacted


def _redact_string(value: str, key_hint: str, ctx: _RedactionContext) -> str:
    lowered = key_hint.lower()
    if ctx.redact_ssid and "ssid" in lowered and value:
        return _named_token(value, "ssid", ctx.ssid_tokens)
    if ctx.redact_vendor and "vendor" in lowered and value:
        return _named_token(value, "vendor", ctx.vendor_tokens)
    prefix = _mac_prefix_for_key(lowered)
    return _MAC_RE.sub(lambda match: _mac_token(match.group(0), prefix, ctx), value)


def _should_drop_key(key: str) -> bool:
    return bool(_SENSITIVE_KEY_RE.search(key) or _DROP_KEY_RE.search(key))


def _mac_prefix_for_key(key_hint: str) -> str:
    if "bssid" in key_hint or "access_point" in key_hint or ".ap" in key_hint:
        return "ap"
    if "client" in key_hint or "mac" in key_hint:
        return "client"
    return "mac"


def _mac_token(value: str, prefix: str, ctx: _RedactionContext) -> str:
    normalized = value.lower().replace("-", ":")
    if ":" not in normalized and len(normalized) == 12:
        normalized = ":".join(normalized[index : index + 2] for index in range(0, 12, 2))
    existing = ctx.replacements.get(normalized)
    if existing is not None:
        return existing
    token = f"{prefix}-{_next_label(ctx, prefix)}"
    ctx.replacements[normalized] = token
    return token


def _named_token(value: str, prefix: str, tokens: dict[str, str]) -> str:
    existing = tokens.get(value)
    if existing is not None:
        return existing
    token = f"{prefix}-{_alpha_label(len(tokens))}"
    tokens[value] = token
    return token


def _next_label(ctx: _RedactionContext, prefix: str) -> str:
    current = ctx.type_counts.get(prefix, 0)
    ctx.type_counts[prefix] = current + 1
    return _alpha_label(current)


def _alpha_label(index: int) -> str:
    base = len(ascii_uppercase)
    label = ""
    value = index
    while True:
        label = ascii_uppercase[value % base] + label
        value = value // base - 1
        if value < 0:
            return label
