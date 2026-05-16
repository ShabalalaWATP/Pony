# SPDX-License-Identifier: AGPL-3.0-only
"""Authenticated backend WebSocket client with reconnect backoff."""

from __future__ import annotations

import asyncio
import json
import random
import ssl
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import websockets

from cheeky_pony_shared import Event, SensorCommand

CommandHandler = Callable[[SensorCommand], Awaitable[dict[str, Any]]]


def build_ssl_context(cert_path: Path, key_path: Path, ca_path: Path | None) -> ssl.SSLContext:
    """Build the client TLS context for mTLS.

    Args:
        cert_path: Client certificate path.
        key_path: Client private key path.
        ca_path: Optional CA certificate path.

    Returns:
        Configured SSL context.
    """

    context = ssl.create_default_context(cafile=str(ca_path) if ca_path else None)
    context.load_cert_chain(certfile=str(cert_path), keyfile=str(key_path))
    return context


def next_backoff(attempt: int, base: float = 0.5, cap: float = 30.0) -> float:
    """Calculate exponential reconnect backoff with jitter.

    Args:
        attempt: Zero-based reconnect attempt.
        base: Base delay in seconds.
        cap: Maximum delay in seconds.

    Returns:
        Delay in seconds.
    """

    delay: float = min(cap, base * (2**attempt))
    jitter = float(random.uniform(0, delay / 4))  # noqa: S311  # nosec B311
    return float(delay + jitter)


class BackendWebSocketClient:
    """Streams events to the backend and accepts commands on one WebSocket."""

    def __init__(
        self,
        url: str,
        ssl_context: ssl.SSLContext | None,
        command_handler: CommandHandler,
    ) -> None:
        self._url = url
        self._ssl_context = ssl_context
        self._command_handler = command_handler
        self._queue: asyncio.Queue[Event] = asyncio.Queue(maxsize=1000)
        self._stopped = asyncio.Event()

    async def enqueue(self, event: Event) -> None:
        """Queue an event for backend delivery.

        Args:
            event: Event to send.
        """

        await self._queue.put(event)

    async def stop(self) -> None:
        """Request the client loop to stop."""

        self._stopped.set()

    async def run_forever(self) -> None:
        """Run the reconnect loop until stopped."""

        attempt = 0
        while not self._stopped.is_set():
            try:
                await self._run_once()
                attempt = 0
            except (OSError, websockets.WebSocketException):
                await asyncio.sleep(next_backoff(attempt))
                attempt += 1

    async def _run_once(self) -> None:
        async with websockets.connect(self._url, ssl=self._ssl_context) as websocket:
            sender = asyncio.create_task(self._send_events(websocket))
            receiver = asyncio.create_task(self._receive_commands(websocket))
            done, pending = await asyncio.wait(
                {sender, receiver},
                return_when=asyncio.FIRST_EXCEPTION,
            )
            for task in pending:
                task.cancel()
            for task in done:
                task.result()

    async def _send_events(self, websocket: Any) -> None:
        while not self._stopped.is_set():
            event = await self._queue.get()
            await websocket.send(event.model_dump_json())

    async def _receive_commands(self, websocket: Any) -> None:
        async for message in websocket:
            data = json.loads(message)
            command = SensorCommand.model_validate(data)
            result = await self._command_handler(command)
            await websocket.send(json.dumps({"kind": "command_result", "payload": result}))
