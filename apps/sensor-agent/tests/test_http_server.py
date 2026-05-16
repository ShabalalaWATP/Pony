# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for the sensor local loopback HTTP server."""

from __future__ import annotations

import asyncio

from cheeky_pony_sensor.http_server import LocalHttpServer


async def test_local_http_server_health() -> None:
    """The local server responds on /health."""

    server = LocalHttpServer("127.0.0.1", 0, lambda: {"capabilities": [], "version": "0.1.0"})
    await server.start()
    assert server._server is not None
    port = server._server.sockets[0].getsockname()[1]
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    writer.write(b"GET /health HTTP/1.1\r\nHost: local\r\n\r\n")
    await writer.drain()
    response = await reader.read()
    writer.close()
    await writer.wait_closed()
    await server.stop()

    assert b"200 OK" in response
    assert b'"status": "ok"' in response


async def test_local_http_server_capabilities_version_and_missing() -> None:
    """The local server routes capabilities, version, and 404 responses."""

    server = LocalHttpServer(
        "127.0.0.1",
        0,
        lambda: {"capabilities": ["passive_capture"], "version": "0.1.0"},
    )
    await server.start()
    assert server._server is not None
    port = server._server.sockets[0].getsockname()[1]
    try:
        capabilities = await _request(port, "/capabilities")
        version = await _request(port, "/version")
        missing = await _request(port, "/missing")
    finally:
        await server.stop()

    assert b"passive_capture" in capabilities
    assert b"0.1.0" in version
    assert b"404 Not Found" in missing


async def _request(port: int, path: str) -> bytes:
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    writer.write(f"GET {path} HTTP/1.1\r\nHost: local\r\n\r\n".encode("ascii"))
    await writer.drain()
    response = await reader.read()
    writer.close()
    await writer.wait_closed()
    return response
