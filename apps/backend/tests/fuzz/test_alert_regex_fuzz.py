# SPDX-License-Identifier: AGPL-3.0-only
"""Atheris target for alert-rule regex predicates."""

from __future__ import annotations

import sys
import time
from collections.abc import Callable

RegexMatcher = Callable[[str, str], bool]

MAX_CASE_BYTES = 512
SLOW_CASE_SECONDS = 0.05

_REGRESSION_CASES = (
    b"^(a+)+$\0" + (b"a" * 64) + b"!",
    b"(a|aa)+$\0" + (b"a" * 64) + b"!",
    b"(a|a?)+$\0" + (b"a" * 64) + b"!",
    b"(?i)free\0Free WiFi",
    b"\\1\0anything",
    b"^Free\0Free Airport WiFi",
)


def fuzz_one_input(data: bytes, regex_matches: RegexMatcher) -> None:
    """Exercise alert regex matching for one libFuzzer input."""

    pattern, value = _decode_case(data)
    _exercise_match(pattern, value, regex_matches)


def main() -> None:
    """Run the Atheris fuzz loop for alert-rule regex predicates."""

    try:
        import atheris
    except ImportError as exc:
        raise SystemExit(
            "Install the backend dev extra on a non-Windows host to run Atheris"
        ) from exc

    with atheris.instrument_imports():
        from cheeky_pony_backend.domain.alerts import _regex_matches

    for case in _REGRESSION_CASES:
        fuzz_one_input(case, _regex_matches)

    atheris.Setup(sys.argv, lambda data: fuzz_one_input(data, _regex_matches))
    atheris.Fuzz()


def _decode_case(data: bytes) -> tuple[str, str]:
    limited = data[:MAX_CASE_BYTES]
    separator = limited.find(b"\0")
    if separator < 0:
        separator = len(limited) // 2
    pattern = limited[:separator].decode("utf-8", errors="ignore")
    value = limited[separator + 1 :].decode("utf-8", errors="ignore")
    return pattern, value


def _exercise_match(pattern: str, value: str, regex_matches: RegexMatcher) -> None:
    started_at = time.perf_counter()
    regex_matches(pattern, value)
    elapsed = time.perf_counter() - started_at
    if elapsed > SLOW_CASE_SECONDS:
        raise RuntimeError(f"alert regex match exceeded {SLOW_CASE_SECONDS:.3f}s: {pattern!r}")


if __name__ == "__main__":
    main()
