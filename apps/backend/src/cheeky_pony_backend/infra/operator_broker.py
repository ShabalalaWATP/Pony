# SPDX-License-Identifier: AGPL-3.0-only
"""In-process broadcaster for authenticated operator WebSocket clients."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import WebSocket


class OperatorBroker:
    """Track operator WebSockets and broadcast JSON messages."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._connections: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket) -> None:
        """Register an accepted operator WebSocket.

        Args:
            websocket: Accepted operator WebSocket.
        """

        async with self._lock:
            self._connections.add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        """Remove an operator WebSocket.

        Args:
            websocket: Operator WebSocket to remove.
        """

        async with self._lock:
            self._connections.discard(websocket)

    async def broadcast(self, payload: dict[str, Any]) -> None:
        """Broadcast one JSON payload to every connected operator.

        Args:
            payload: JSON-ready message payload.
        """

        for websocket in await self._snapshot():
            await self._send_or_drop(websocket, payload)

    async def _snapshot(self) -> tuple[WebSocket, ...]:
        async with self._lock:
            return tuple(self._connections)

    async def _send_or_drop(self, websocket: WebSocket, payload: dict[str, Any]) -> None:
        try:
            await websocket.send_json(payload)
        except RuntimeError:
            await self.disconnect(websocket)
