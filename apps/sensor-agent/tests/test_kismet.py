# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for Kismet process and API integration helpers."""

from __future__ import annotations

import asyncio

import pytest

from cheeky_pony_sensor.kismet import KismetClient, KismetProcessManager

pytestmark = pytest.mark.asyncio


async def test_kismet_health_reads_status_json() -> None:
    """Kismet health parses status JSON from a local HTTP endpoint."""

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        await reader.readuntil(b"\r\n\r\n")
        body = b'{"kismet": "ok"}'
        writer.write(
            b"HTTP/1.1 200 OK\r\n"
            + b"Content-Type: application/json\r\n"
            + f"Content-Length: {len(body)}\r\n\r\n".encode("ascii")
            + body
        )
        await writer.drain()
        writer.close()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        payload = await KismetClient(f"http://127.0.0.1:{port}", "ws://unused").health()
    finally:
        server.close()
        await server.wait_closed()

    assert payload == {"kismet": "ok"}


async def test_kismet_process_manager_uses_systemctl(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """Kismet process manager starts the systemd user service."""

    calls: list[list[str]] = []

    class FakeProcess:
        async def wait(self) -> int:
            return 0

    async def fake_exec(*argv: str) -> FakeProcess:
        calls.append(list(argv))
        return FakeProcess()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    await KismetProcessManager(user_service=True).start()

    assert calls == [["systemctl", "--user", "start", "kismet"]]
