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
        self._connections: dict[WebSocket, str] = {}

    async def connect(self, websocket: WebSocket, user_id: str) -> None:
        """Register an accepted operator WebSocket.

        Args:
            websocket: Accepted operator WebSocket.
            user_id: Authenticated operator id bound to the socket.
        """

        async with self._lock:
            self._connections[websocket] = user_id

    async def disconnect(self, websocket: WebSocket) -> None:
        """Remove an operator WebSocket.

        Args:
            websocket: Operator WebSocket to remove.
        """

        async with self._lock:
            self._connections.pop(websocket, None)

    async def disconnect_user(self, user_id: str) -> None:
        """Close every operator WebSocket authenticated as one user."""

        sockets = await self._remove_user_sockets(user_id)
        for websocket in sockets:
            try:
                await websocket.close()
            except RuntimeError:
                continue

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

    async def _remove_user_sockets(self, user_id: str) -> tuple[WebSocket, ...]:
        async with self._lock:
            sockets = tuple(
                websocket
                for websocket, connected_user_id in self._connections.items()
                if connected_user_id == user_id
            )
            for websocket in sockets:
                self._connections.pop(websocket, None)
            return sockets

    async def _send_or_drop(self, websocket: WebSocket, payload: dict[str, Any]) -> None:
        try:
            await websocket.send_json(payload)
        except RuntimeError:
            await self.disconnect(websocket)
