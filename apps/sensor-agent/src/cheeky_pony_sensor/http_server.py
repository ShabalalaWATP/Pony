# SPDX-License-Identifier: AGPL-3.0-only
"""Local loopback HTTP server for sensor health, capabilities, and version."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from typing import Any


class LocalHttpServer:
    """Tiny dependency-free HTTP server bound to loopback."""

    def __init__(
        self,
        host: str,
        port: int,
        payload_provider: Callable[[], dict[str, Any]],
    ) -> None:
        self._host = host
        self._port = port
        self._payload_provider = payload_provider
        self._server: asyncio.AbstractServer | None = None

    async def start(self) -> None:
        """Start the local HTTP server."""

        self._server = await asyncio.start_server(self._handle, self._host, self._port)

    async def stop(self) -> None:
        """Stop the local HTTP server."""

        if self._server is None:
            return
        self._server.close()
        await self._server.wait_closed()

    async def _handle(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        request = await reader.readline()
        path = request.decode("ascii", errors="ignore").split(" ")[1:2]
        while await reader.readline() not in {b"\r\n", b""}:
            pass
        response = self._route(path[0] if path else "/")
        writer.write(response)
        await writer.drain()
        writer.close()
        await writer.wait_closed()

    def _route(self, path: str) -> bytes:
        payload = self._payload_provider()
        if path == "/health":
            return _json_response({"status": "ok"})
        if path == "/capabilities":
            return _json_response({"capabilities": payload.get("capabilities", [])})
        if path == "/version":
            return _json_response({"version": payload.get("version", "unknown")})
        return b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n"


def _json_response(payload: dict[str, Any]) -> bytes:
    body = json.dumps(payload).encode("utf-8")
    headers = [
        b"HTTP/1.1 200 OK",
        b"Content-Type: application/json",
        f"Content-Length: {len(body)}".encode("ascii"),
        b"Connection: close",
        b"",
        b"",
    ]
    return b"\r\n".join(headers) + body
