# SPDX-License-Identifier: AGPL-3.0-only
"""Kismet process and API integration for passive sensor collection."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
import websockets


class KismetProcessManager:
    """Starts Kismet through systemd or a direct process."""

    def __init__(self, user_service: bool = True) -> None:
        self._user_service = user_service

    async def start(self) -> None:
        """Start Kismet through systemd user service."""

        args = ["systemctl"]
        if self._user_service:
            args.append("--user")
        args.extend(["start", "kismet"])
        process = await asyncio.create_subprocess_exec(*args)
        await process.wait()


class KismetClient:
    """Small client for Kismet status and event streams."""

    def __init__(self, base_url: str, event_ws_url: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._event_ws_url = event_ws_url

    async def health(self) -> dict[str, Any]:
        """Fetch Kismet health status.

        Returns:
            Parsed Kismet status payload.
        """

        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{self._base_url}/system/status.json")
            response.raise_for_status()
            payload: dict[str, Any] = response.json()
            return payload

    async def events(self) -> AsyncIterator[dict[str, Any]]:
        """Subscribe to the Kismet event WebSocket.

        Yields:
            Parsed JSON event payloads.
        """

        async with websockets.connect(self._event_ws_url) as websocket:
            async for message in websocket:
                if isinstance(message, bytes):
                    message = message.decode("utf-8", errors="replace")
                try:
                    payload = json.loads(message)
                except json.JSONDecodeError:
                    continue
                if isinstance(payload, dict):
                    yield payload
