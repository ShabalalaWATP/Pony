# SPDX-License-Identifier: AGPL-3.0-only
"""Add AGPL SPDX headers to source files that are missing them."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HEADER = "# SPDX-License-Identifier: AGPL-3.0-only"
SHELL_HEADER = "# SPDX-License-Identifier: AGPL-3.0-only"
PY_SUFFIXES = {".py"}
SHELL_SUFFIXES = {".sh"}
EXCLUDED_DIRS = {".git", ".venv", "node_modules", "__pycache__"}


def main() -> None:
    """Add SPDX headers to Python and shell sources."""

    for path in ROOT.rglob("*"):
        if not path.is_file() or any(part in EXCLUDED_DIRS for part in path.parts):
            continue
        if path.suffix in PY_SUFFIXES:
            _ensure_header(path, HEADER)
        if path.suffix in SHELL_SUFFIXES:
            _ensure_header(path, SHELL_HEADER)


def _ensure_header(path: Path, header: str) -> None:
    text = path.read_text(encoding="utf-8")
    if "SPDX-License-Identifier: AGPL-3.0-only" in text[:200]:
        return
    if text.startswith("#!"):
        first, rest = text.split("\n", 1)
        path.write_text(f"{first}\n{header}\n{rest}", encoding="utf-8")
        return
    path.write_text(f"{header}\n{text}", encoding="utf-8")


if __name__ == "__main__":
    main()
