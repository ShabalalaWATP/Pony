# SPDX-License-Identifier: AGPL-3.0-only
"""Public OUI vendor lookup routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, status
from pydantic import BaseModel, ConfigDict

from cheeky_pony_backend.dependencies import check_auth_rate_limit, get_oui_service
from cheeky_pony_backend.domain.oui_lookup import OuiService

router = APIRouter(
    prefix="/oui",
    tags=["oui"],
    dependencies=[Depends(check_auth_rate_limit)],
)


class OuiLookupResponse(BaseModel):
    """Vendor metadata for a public OUI prefix."""

    model_config = ConfigDict(extra="forbid")

    prefix: str
    short_vendor: str
    long_vendor: str


@router.get("/{prefix}", response_model=OuiLookupResponse)
async def lookup_oui(
    prefix: Annotated[
        str,
        Path(pattern=r"^(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2})$"),
    ],
    oui: Annotated[OuiService, Depends(get_oui_service)],
) -> OuiLookupResponse:
    """Resolve a public OUI prefix without exposing operator data.

    Args:
        prefix: Six-hex-character OUI prefix, with or without colons.
        oui: OUI lookup service.

    Returns:
        Resolved public vendor metadata.
    """

    vendor = oui.lookup(prefix)
    if vendor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="oui_not_found")
    return OuiLookupResponse(
        prefix=vendor.prefix,
        short_vendor=vendor.short_vendor,
        long_vendor=vendor.long_vendor,
    )
