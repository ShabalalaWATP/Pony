# SPDX-License-Identifier: AGPL-3.0-only
"""Runtime tests for backend WebSocket client internals."""

from __future__ import annotations

import json

from cheeky_pony_sensor.ws_client import BackendWebSocketClient
from cheeky_pony_shared import Event, EventKind


class FakeWebSocket:
    """Fake async WebSocket for receive-command tests."""

    def __init__(self, messages: list[dict[str, object]]) -> None:
        self._messages = messages
        self.sent: list[str] = []

    def __aiter__(self) -> FakeWebSocket:
        return self

    async def __anext__(self) -> str:
        if not self._messages:
            raise StopAsyncIteration
        return json.dumps(self._messages.pop(0))

    async def send(self, payload: str) -> None:
        """Record a sent payload."""

        self.sent.append(payload)


async def test_receive_commands_sends_handler_result() -> None:
    """BackendWebSocketClient receives commands and sends result payloads."""

    async def handler(command):  # type: ignore[no-untyped-def]
        return {"command_id": command.id, "accepted": True}

    websocket = FakeWebSocket(
        [{"id": "cmd-1", "kind": "start_capture", "parameters": {}, "lab_mode": False}]
    )
    client = BackendWebSocketClient("ws://unused", None, handler)

    await client._receive_commands(websocket)

    assert json.loads(websocket.sent[0])["payload"]["accepted"] is True


async def test_enqueue_and_stop_set_internal_state() -> None:
    """BackendWebSocketClient queues events and records stop requests."""

    async def handler(command):  # type: ignore[no-untyped-def]
        return {"command_id": command.id}

    client = BackendWebSocketClient("ws://unused", None, handler)
    event = Event(
        id="evt-1",
        sensor_id="pi-1",
        kind=EventKind.SENSOR_STATUS,
        payload={"ok": True},
    )

    await client.enqueue(event)
    await client.stop()

    assert await client._queue.get() == event
    assert client._stopped.is_set()
