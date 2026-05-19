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
    lab_module: str | None = None
    engagement_id: str | None = None
    target: dict[str, str] | None = None


@dataclass(frozen=True)
class LabCommandRecord:
    """Active lab command state for dashboard and stop flows."""

    command_id: str
    module: str
    sensor_id: str
    engagement_id: str
    target: dict[str, str]
    started_at: datetime
    parameters: dict[str, Any]


class SensorCommandBroker:
    """Track connected sensors and deliver queued commands."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._connections: dict[str, WebSocket] = {}
        self._pending: dict[str, list[SensorCommand]] = {}
        self._metadata: dict[str, SensorCommandMetadata] = {}
        self._active_lab: dict[str, LabCommandRecord] = {}

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

    async def command_sensor_id(self, command_id: str) -> str | None:
        """Return the sensor id associated with a pending command."""

        async with self._lock:
            metadata = self._metadata.get(command_id)
            return None if metadata is None else metadata.sensor_id

    async def complete(self, sensor_id: str, command_id: str) -> SensorCommandMetadata | None:
        """Pop metadata for a completed command.

        Args:
            sensor_id: Reporting sensor identifier.
            command_id: Command identifier.

        Returns:
            Stored metadata when known and owned by the reporting sensor.
        """

        async with self._lock:
            metadata = self._metadata.get(command_id)
            if metadata is None or metadata.sensor_id != sensor_id:
                return None
            return self._metadata.pop(command_id)

    async def start_lab_command(self, record: LabCommandRecord) -> None:
        """Track an active lab command.

        Args:
            record: Active lab command record.
        """

        async with self._lock:
            self._active_lab[record.command_id] = record

    async def get_lab_command(self, command_id: str) -> LabCommandRecord | None:
        """Return one active lab command.

        Args:
            command_id: Active lab command identifier.

        Returns:
            Active lab command when present.
        """

        async with self._lock:
            return self._active_lab.get(command_id)

    async def stop_lab_command(self, command_id: str) -> LabCommandRecord | None:
        """Remove one active lab command.

        Args:
            command_id: Active lab command identifier.

        Returns:
            Removed lab command when present.
        """

        async with self._lock:
            return self._active_lab.pop(command_id, None)

    async def list_lab_commands(self) -> list[LabCommandRecord]:
        """Return active lab commands.

        Returns:
            Active lab command records.
        """

        async with self._lock:
            return list(self._active_lab.values())

    async def stop_lab_commands_for_engagement(self, engagement_id: str) -> list[LabCommandRecord]:
        """Remove active lab commands for an engagement.

        Args:
            engagement_id: Engagement identifier.

        Returns:
            Removed lab command records.
        """

        async with self._lock:
            records = [
                record
                for record in self._active_lab.values()
                if record.engagement_id == engagement_id
            ]
            for record in records:
                self._active_lab.pop(record.command_id, None)
            return records

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
