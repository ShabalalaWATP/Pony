# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for sensor command dispatch."""

from __future__ import annotations

import sys

from cheeky_pony_sensor.commands import CommandDispatcher, ToolRunner, result_payload
from cheeky_pony_shared import CommandKind, SensorCapability, SensorCommand


class FakeRunner(ToolRunner):
    """Fake runner that records argv."""

    def __init__(self) -> None:
        self.argv: list[str] | None = None
        self.argv_history: list[list[str]] = []

    async def run(self, argv: list[str], timeout_seconds: float = 20.0) -> str:
        """Record command arguments and return fake output."""

        self.argv = argv
        self.argv_history.append(argv)
        return "ok"


async def test_start_module_requires_lab_mode() -> None:
    """Active modules are rejected locally when lab mode is false."""

    dispatcher = CommandDispatcher(
        {SensorCapability.ACTIVE_MODULES, SensorCapability.DEAUTH},
        FakeRunner(),
    )
    result = await dispatcher.dispatch(
        SensorCommand(
            id="cmd-1",
            kind=CommandKind.START_MODULE,
            parameters={"module": "deauth"},
            lab_mode=False,
        )
    )

    assert result.accepted is False
    assert result.outcome == "lab_mode_required"


async def test_set_channel_uses_argument_list() -> None:
    """Channel changes are executed through argv lists."""

    runner = FakeRunner()
    dispatcher = CommandDispatcher({SensorCapability.CHANNEL_CONTROL}, runner)
    result = await dispatcher.dispatch(
        SensorCommand(
            id="cmd-1",
            kind=CommandKind.SET_CHANNEL,
            parameters={"channel": 6},
            interface="wlan2",
        )
    )

    assert result.accepted is True
    assert runner.argv == ["iw", "dev", "wlan2", "set", "channel", "6"]


async def test_set_channel_rejects_invalid_interface() -> None:
    """Invalid interface names are refused before invoking iw."""

    runner = FakeRunner()
    dispatcher = CommandDispatcher({SensorCapability.CHANNEL_CONTROL}, runner)
    result = await dispatcher.dispatch(
        SensorCommand(
            id="cmd-1",
            kind=CommandKind.SET_CHANNEL,
            parameters={"channel": 6},
            interface="mon0 type monitor",
        )
    )

    assert result.accepted is False
    assert result.outcome == "denied:invalid_interface"
    assert runner.argv is None


async def test_passive_and_active_command_branches() -> None:
    """Dispatcher covers passive capture and active module branches."""

    dispatcher = CommandDispatcher(
        {
            SensorCapability.ACTIVE_MODULES,
            SensorCapability.DEAUTH,
            SensorCapability.CHANNEL_CONTROL,
        },
        FakeRunner(),
    )

    stop_module = await dispatcher.dispatch(SensorCommand(id="cmd-1", kind=CommandKind.STOP_MODULE))
    stop_capture = await dispatcher.dispatch(
        SensorCommand(id="cmd-2", kind=CommandKind.STOP_CAPTURE)
    )
    active_allowed = await dispatcher.dispatch(
        SensorCommand(
            id="cmd-3",
            kind=CommandKind.START_MODULE,
            parameters={"module": "deauth"},
            lab_mode=True,
        )
    )
    missing_module = await dispatcher.dispatch(
        SensorCommand(
            id="cmd-4",
            kind=CommandKind.START_MODULE,
            parameters={"module": "unknown"},
            lab_mode=True,
        )
    )
    no_channel_capability = await CommandDispatcher(set(), FakeRunner()).dispatch(
        SensorCommand(id="cmd-5", kind=CommandKind.SET_CHANNEL, parameters={"channel": 1})
    )

    assert stop_module.outcome == "stopped"
    assert stop_capture.outcome == "capture_stopped"
    assert active_allowed.outcome == "module_start_allowed"
    assert missing_module.outcome == "module_not_advertised"
    assert no_channel_capability.outcome == "capability_not_advertised"


async def test_lifecycle_commands_use_argument_lists() -> None:
    """Restart and update commands are dispatched through argv lists."""

    runner = FakeRunner()
    dispatcher = CommandDispatcher(set(), runner)

    restart = await dispatcher.dispatch(SensorCommand(id="cmd-1", kind=CommandKind.RESTART))
    update = await dispatcher.dispatch(SensorCommand(id="cmd-2", kind=CommandKind.UPDATE))

    assert restart.outcome == "restart_requested"
    assert update.outcome == "update_requested"
    assert runner.argv_history == [
        [
            "systemd-run",
            "--user",
            "--on-active=2",
            "systemctl",
            "--user",
            "restart",
            "cheeky-pony-sensor.service",
        ],
        ["cheeky-pony-sensor-update"],
    ]


async def test_result_payload_includes_command_lifecycle_fields() -> None:
    """Command result payloads include command name and timestamps."""

    result = await CommandDispatcher(set(), FakeRunner()).dispatch(
        SensorCommand(id="cmd-1", kind=CommandKind.RESTART)
    )
    payload = result_payload(result)

    assert payload["command"] == "restart"
    assert payload["started_at"]
    assert payload["finished_at"]


async def test_tool_runner_executes_argument_list() -> None:
    """ToolRunner executes a process through argv and captures output."""

    output = await ToolRunner().run([sys.executable, "-c", "print('ok')"])

    assert output == "ok"
