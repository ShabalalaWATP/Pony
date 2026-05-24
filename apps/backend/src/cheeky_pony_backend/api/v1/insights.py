# SPDX-License-Identifier: AGPL-3.0-only
"""LLM insight API routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse

from cheeky_pony_backend.dependencies import current_user, get_llm_insight_service
from cheeky_pony_backend.domain.users import UserRecord
from cheeky_pony_backend.llm.errors import LlmEntityNotFoundError, LlmInsightUnavailableError
from cheeky_pony_backend.llm.service import LlmInsightService
from cheeky_pony_backend.llm.types import Insight

router = APIRouter(prefix="/insights", tags=["insights"])


@router.get("/alert/{alert_id}", response_model=Insight)
async def get_alert_context_insight(
    alert_id: str,
    user: Annotated[UserRecord, Depends(current_user)],
    service: Annotated[LlmInsightService, Depends(get_llm_insight_service)],
) -> Insight | JSONResponse:
    """Return LLM-generated context for an alert."""

    try:
        return await service.alert_context(alert_id, actor_id=user.id)
    except LlmEntityNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="alert_not_found"
        ) from exc
    except LlmInsightUnavailableError as exc:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"detail": "llm_unavailable", "reason": exc.reason},
        )
