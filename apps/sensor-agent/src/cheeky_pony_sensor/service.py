# SPDX-License-Identifier: AGPL-3.0-only
"""Top-level sensor-agent orchestration."""

from __future__ import annotations

import asyncio
from typing import Any

from cheeky_pony_sensor.commands import CommandDispatcher, result_payload
from cheeky_pony_sensor.config import SensorConfig
from cheeky_pony_sensor.http_server import LocalHttpServer
from cheeky_pony_sensor.kismet import KismetClient, KismetProcessManager
from cheeky_pony_sensor.normalizers import normalize_kismet_device
from cheeky_pony_sensor.ws_client import BackendWebSocketClient, build_ssl_context
from cheeky_pony_shared import Event, EventKind, SensorCapability, SensorCommand


class SensorAgent:
    """Coordinates local Kismet collection and backend streaming."""

    def __init__(self, config: SensorConfig) -> None:
        self._config = config
        self._capabilities = {
            SensorCapability.PASSIVE_CAPTURE,
            SensorCapability.CHANNEL_CONTROL,
        }
        self._dispatcher = CommandDispatcher(self._capabilities)
        self._kismet = KismetClient(str(config.kismet_base_url), config.kismet_event_ws_url)
        ssl_context = build_ssl_context(
            config.client_cert_path,
            config.client_key_path,
            config.ca_cert_path,
        )
        self._backend = BackendWebSocketClient(
            config.backend_ws_url,
            ssl_context,
            self.handle_command,
        )
        self._http = LocalHttpServer(
            config.local_http_host,
            config.local_http_port,
            self.status_payload,
        )

    def status_payload(self) -> dict[str, Any]:
        """Return local status fields exposed over loopback HTTP.

        Returns:
            JSON-ready status payload.
        """

        return {
            "sensor_id": self._config.sensor_id,
            "capabilities": sorted(cap.value for cap in self._capabilities),
            "version": self._config.version,
        }

    async def handle_command(self, command: SensorCommand) -> dict[str, Any]:
        """Handle a command received from the backend.

        Args:
            command: Validated command.

        Returns:
            JSON-ready command result payload.
        """

        result = await self._dispatcher.dispatch(command)
        return result_payload(result)

    async def run(self) -> None:
        """Run the sensor-agent until cancelled."""

        if self._config.manage_kismet:
            await KismetProcessManager(self._config.kismet_user_service).start()
        await self._http.start()
        backend_task = asyncio.create_task(self._backend.run_forever())
        kismet_task = asyncio.create_task(self._pump_kismet_events())
        try:
            await asyncio.gather(backend_task, kismet_task)
        finally:
            await self._backend.stop()
            await self._http.stop()

    async def _pump_kismet_events(self) -> None:
        async for payload in self._kismet.events():
            for event in normalize_kismet_device(payload, self._config.sensor_id):
                await self._backend.enqueue(event)

    async def emit_status(self, payload: dict[str, Any]) -> None:
        """Emit a local status event to the backend.

        Args:
            payload: Status payload.
        """

        await self._backend.enqueue(
            Event(
                id=f"{self._config.sensor_id}-status",
                sensor_id=self._config.sensor_id,
                kind=EventKind.SENSOR_STATUS,
                payload=payload,
            )
        )
