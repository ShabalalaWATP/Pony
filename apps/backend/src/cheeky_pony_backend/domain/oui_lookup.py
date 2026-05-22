# SPDX-License-Identifier: AGPL-3.0-only
"""OUI vendor lookup over the bundled Wireshark manufacturer table."""

from __future__ import annotations

import csv
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

OUI_DB_VERSION = "wireshark-manuf-2026-05-22"
DEFAULT_OUI_TABLE = Path(__file__).resolve().parents[3] / "data" / "manuf.tsv"
_HEX_PREFIX = re.compile(r"^[0-9a-f]{6}$")


@dataclass(frozen=True)
class OuiVendor:
    """Resolved OUI vendor metadata."""

    prefix: str
    short_vendor: str
    long_vendor: str


class OuiService:
    """Resolve MAC addresses or OUI prefixes against a loaded vendor table."""

    def __init__(self, vendors: Mapping[str, OuiVendor]) -> None:
        """Create a lookup service from normalized vendor rows.

        Args:
            vendors: Mapping keyed by lowercase `xx:xx:xx` prefixes.
        """

        self._vendors = dict(vendors)

    def lookup(self, mac: str) -> OuiVendor | None:
        """Resolve the first three octets from a MAC address or OUI prefix.

        Args:
            mac: MAC address or OUI prefix supplied by a caller.

        Returns:
            Vendor metadata when the prefix is known.
        """

        prefix = normalize_oui_prefix(mac)
        if prefix is None:
            return None
        return self._vendors.get(prefix)


def create_oui_service(path: Path = DEFAULT_OUI_TABLE) -> OuiService:
    """Load an OUI table into an immutable lookup service.

    Args:
        path: Table path with prefix, short vendor, and long vendor columns.

    Returns:
        Ready-to-use OUI lookup service.
    """

    return OuiService(load_oui_table(path))


def load_oui_table(path: Path = DEFAULT_OUI_TABLE) -> dict[str, OuiVendor]:
    """Load a tab-separated OUI table from disk.

    Args:
        path: Table path with prefix, short vendor, and long vendor columns.

    Returns:
        Mapping of normalized OUI prefixes to vendor metadata.
    """

    vendors: dict[str, OuiVendor] = {}
    with path.open("r", encoding="utf-8", newline="") as table:
        reader = csv.reader(table, delimiter="\t")
        for row in reader:
            vendor = _vendor_from_row(row)
            if vendor is not None:
                vendors[vendor.prefix] = vendor
    return vendors


def normalize_oui_prefix(value: str) -> str | None:
    """Normalize a MAC address or OUI string to `xx:xx:xx` form.

    Args:
        value: Untrusted MAC address or OUI input.

    Returns:
        Normalized prefix, or None when the input does not contain one.
    """

    compact = re.sub(r"[^0-9A-Fa-f]", "", value).lower()
    if len(compact) < 6:
        return None
    prefix = compact[:6]
    if not _HEX_PREFIX.fullmatch(prefix):
        return None
    return ":".join(prefix[index : index + 2] for index in range(0, 6, 2))


def _vendor_from_row(row: list[str]) -> OuiVendor | None:
    if len(row) != 3:
        return None
    prefix = normalize_oui_prefix(row[0])
    if prefix is None:
        return None
    short_vendor = row[1].strip()
    long_vendor = row[2].strip()
    if not short_vendor or not long_vendor:
        return None
    return OuiVendor(prefix=prefix, short_vendor=short_vendor, long_vendor=long_vendor)
