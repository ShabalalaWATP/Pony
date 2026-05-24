# SPDX-License-Identifier: AGPL-3.0-only
"""Runtime control flags for the LLM subsystem."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Protocol

from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, ConfigDict

from cheeky_pony_backend.config import Settings

_LLM_KILL_SWITCH_ID = "llm_kill_switch"


class LlmRuntimeFlag(BaseModel):
    """Persisted runtime flag state."""

    model_config = ConfigDict(extra="forbid")

    id: str
    disabled: bool
    updated_at: datetime


class LlmRuntimeFlags(Protocol):
    """Persistence boundary for operator-controlled LLM runtime flags."""

    async def ensure_indexes(self) -> None:
        """Create backing indexes."""

    async def llm_disabled(self) -> bool:
        """Return whether the DB kill switch disables the LLM."""

    async def set_llm_disabled(self, disabled: bool) -> LlmRuntimeFlag:
        """Persist the DB kill-switch state."""


class InMemoryLlmRuntimeFlags:
    """In-memory runtime flags for tests."""

    def __init__(self) -> None:
        self.flag: LlmRuntimeFlag | None = None

    async def ensure_indexes(self) -> None:
        """No-op for in-memory storage."""

    async def llm_disabled(self) -> bool:
        """Return the in-memory kill-switch state."""

        return self.flag.disabled if self.flag is not None else False

    async def set_llm_disabled(self, disabled: bool) -> LlmRuntimeFlag:
        """Persist the in-memory kill-switch state."""

        self.flag = LlmRuntimeFlag(
            id=_LLM_KILL_SWITCH_ID,
            disabled=disabled,
            updated_at=datetime.now(tz=UTC),
        )
        return self.flag


class MongoLlmRuntimeFlags:
    """Mongo-backed runtime flags."""

    def __init__(self, db: AsyncIOMotorDatabase[dict[str, object]]) -> None:
        self._db = db

    async def ensure_indexes(self) -> None:
        """Create runtime flag indexes."""

        await self._db.system_runtime_flags.create_index("id", unique=True)

    async def llm_disabled(self) -> bool:
        """Return the Mongo kill-switch state."""

        doc = await self._db.system_runtime_flags.find_one(
            {"id": _LLM_KILL_SWITCH_ID},
            {"_id": False},
        )
        if doc is None:
            return False
        return LlmRuntimeFlag.model_validate(doc).disabled

    async def set_llm_disabled(self, disabled: bool) -> LlmRuntimeFlag:
        """Persist the Mongo kill-switch state."""

        flag = LlmRuntimeFlag(
            id=_LLM_KILL_SWITCH_ID,
            disabled=disabled,
            updated_at=datetime.now(tz=UTC),
        )
        await self._db.system_runtime_flags.replace_one(
            {"id": _LLM_KILL_SWITCH_ID},
            flag.model_dump(mode="json"),
            upsert=True,
        )
        return flag


async def llm_effectively_enabled(
    settings: Settings,
    runtime_flags: LlmRuntimeFlags | None,
) -> bool:
    """Return whether the LLM may dispatch under env and runtime gates."""

    if not settings.llm_enabled:
        return False
    if runtime_flags is None:
        return True
    return not await runtime_flags.llm_disabled()
