# SPDX-License-Identifier: AGPL-3.0-only
"""In-process command broker for connected sensor WebSockets."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from fastapi import WebSocket

from cheeky_pony_shared import CommandKind, SensorCommand


@dataclass(frozen=True)
class SensorCommandMetadata:
    """Metadata tracked for a command awaiting sensor completion."""

    command_id: str
    sensor_id: str
    command: CommandKind
    actor_id: str
    parameters: dict[str, Any]
    started_at: datetime
    audit_id: str


class SensorCommandBroker:
    """Track connected sensors and deliver queued commands."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._connections: dict[str, WebSocket] = {}
        self._pending: dict[str, list[SensorCommand]] = {}
        self._metadata: dict[str, SensorCommandMetadata] = {}

    async def connect(self, sensor_id: str, websocket: WebSocket) -> None:
        """Register a connected sensor and flush pending commands.

        Args:
            sensor_id: Sensor identifier.
            websocket: Accepted sensor WebSocket.
        """

        async with self._lock:
            self._connections[sensor_id] = websocket
            pending = self._pending.pop(sensor_id, [])
        for command in pending:
            await websocket.send_json(command.model_dump(mode="json"))

    async def disconnect(self, sensor_id: str, websocket: WebSocket) -> None:
        """Remove a connected sensor if the WebSocket still matches.

        Args:
            sensor_id: Sensor identifier.
            websocket: Sensor WebSocket being closed.
        """

        async with self._lock:
            if self._connections.get(sensor_id) is websocket:
                self._connections.pop(sensor_id, None)

    async def remember(self, metadata: SensorCommandMetadata) -> None:
        """Store command metadata for completion handling.

        Args:
            metadata: Command metadata.
        """

        async with self._lock:
            self._metadata[metadata.command_id] = metadata

    async def send(self, sensor_id: str, command: SensorCommand) -> None:
        """Send or queue one command for a sensor.

        Args:
            sensor_id: Sensor identifier.
            command: Validated command.
        """

        async with self._lock:
            websocket = self._connections.get(sensor_id)
            if websocket is None:
                self._pending.setdefault(sensor_id, []).append(command)
                return
        try:
            await websocket.send_json(command.model_dump(mode="json"))
        except RuntimeError:
            await self._queue_after_failed_send(sensor_id, command, websocket)

    async def complete(self, command_id: str) -> SensorCommandMetadata | None:
        """Pop metadata for a completed command.

        Args:
            command_id: Command identifier.

        Returns:
            Stored metadata when known.
        """

        async with self._lock:
            return self._metadata.pop(command_id, None)

    async def _queue_after_failed_send(
        self,
        sensor_id: str,
        command: SensorCommand,
        websocket: WebSocket,
    ) -> None:
        async with self._lock:
            if self._connections.get(sensor_id) is websocket:
                self._connections.pop(sensor_id, None)
            self._pending.setdefault(sensor_id, []).append(command)
