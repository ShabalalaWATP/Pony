# SPDX-License-Identifier: AGPL-3.0-only
"""Command dispatch and safe local tool execution for the sensor-agent."""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Any

from cheeky_pony_shared import CommandKind, SensorCapability, SensorCommand

_INTERFACE_RE = re.compile(r"^wlan[0-9]+$")


@dataclass(frozen=True)
class CommandResult:
    """Result returned after dispatching a command."""

    command_id: str
    accepted: bool
    outcome: str
    output: str = ""
    command: str = ""
    started_at: datetime | None = None
    finished_at: datetime | None = None


class ToolRunner:
    """Runs local commands using argument lists only."""

    async def run(self, argv: list[str], timeout_seconds: float = 20.0) -> str:
        """Run a local process without shell interpolation.

        Args:
            argv: Executable and arguments.
            timeout_seconds: Process timeout.

        Returns:
            Combined stdout and stderr.
        """

        process = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout_seconds)
        except TimeoutError:
            process.kill()
            await process.wait()
            return "timed out"
        return "\n".join(
            part.decode("utf-8", errors="replace").strip() for part in (stdout, stderr) if part
        )


class CommandDispatcher:
    """Dispatches backend commands to local sensor capabilities."""

    def __init__(
        self,
        capabilities: set[SensorCapability],
        runner: ToolRunner | None = None,
    ) -> None:
        self._capabilities = capabilities
        self._runner = runner or ToolRunner()
        self._capturing = False

    async def dispatch(self, command: SensorCommand) -> CommandResult:
        """Dispatch one backend command.

        Args:
            command: Validated command envelope.

        Returns:
            Command execution result.
        """

        started_at = datetime.now(tz=UTC)
        try:
            result = await self._dispatch(command)
        except Exception as exc:  # noqa: BLE001
            result = CommandResult(command.id, False, "error", str(exc))
        return replace(
            result,
            command=command.kind.value,
            started_at=started_at,
            finished_at=datetime.now(tz=UTC),
        )

    async def _dispatch(self, command: SensorCommand) -> CommandResult:
        if command.kind == CommandKind.START_MODULE:
            return await self._start_module(command)
        if command.kind == CommandKind.STOP_MODULE:
            return CommandResult(command.id, True, "stopped")
        if command.kind == CommandKind.RESTART:
            return await self._restart(command)
        if command.kind == CommandKind.UPDATE:
            return await self._update(command)
        if command.kind == CommandKind.START_CAPTURE:
            self._capturing = True
            return CommandResult(command.id, True, "capture_started")
        if command.kind == CommandKind.STOP_CAPTURE:
            self._capturing = False
            return CommandResult(command.id, True, "capture_stopped")
        if command.kind == CommandKind.SET_CHANNEL:
            return await self._set_channel(command)
        return CommandResult(command.id, False, "unsupported")

    async def _set_channel(self, command: SensorCommand) -> CommandResult:
        channel = int(command.parameters.get("channel", 0))
        interface = command.interface or "wlan1"
        if SensorCapability.CHANNEL_CONTROL not in self._capabilities:
            return CommandResult(command.id, False, "capability_not_advertised")
        if not _INTERFACE_RE.fullmatch(interface):
            return CommandResult(command.id, False, "denied:invalid_interface")
        output = await self._runner.run(["iw", "dev", interface, "set", "channel", str(channel)])
        return CommandResult(command.id, True, "channel_set", output)

    async def _restart(self, command: SensorCommand) -> CommandResult:
        output = await self._runner.run(
            [
                "systemd-run",
                "--user",
                "--on-active=2",
                "systemctl",
                "--user",
                "restart",
                "cheeky-pony-sensor.service",
            ],
            timeout_seconds=10.0,
        )
        return CommandResult(command.id, True, "restart_requested", output)

    async def _update(self, command: SensorCommand) -> CommandResult:
        output = await self._runner.run(["cheeky-pony-sensor-update"], timeout_seconds=120.0)
        return CommandResult(command.id, True, "update_requested", output)

    async def _start_module(self, command: SensorCommand) -> CommandResult:
        module = str(command.parameters.get("module", ""))
        if SensorCapability.ACTIVE_MODULES not in self._capabilities:
            return CommandResult(command.id, False, "capability_not_advertised")
        if not command.lab_mode:
            return CommandResult(command.id, False, "lab_mode_required")
        required = _capability_for_module(module)
        if required is None or required not in self._capabilities:
            return CommandResult(command.id, False, "module_not_advertised")
        return CommandResult(command.id, True, "module_start_allowed")


def _capability_for_module(module: str) -> SensorCapability | None:
    mapping: dict[str, SensorCapability] = {
        "rogue_ap": SensorCapability.ROGUE_AP,
        "deauth": SensorCapability.DEAUTH,
        "evil_twin": SensorCapability.EVIL_TWIN,
        "captive_portal": SensorCapability.CAPTIVE_PORTAL,
        "mitm": SensorCapability.MITM,
    }
    return mapping.get(module)


def result_payload(result: CommandResult) -> dict[str, Any]:
    """Convert a command result to a serializable payload.

    Args:
        result: Command result.

    Returns:
        JSON-ready command result payload.
    """

    payload = {
        "command_id": result.command_id,
        "accepted": result.accepted,
        "outcome": result.outcome,
        "output": result.output,
    }
    if result.command:
        payload["command"] = result.command
    if result.started_at is not None:
        payload["started_at"] = result.started_at.isoformat()
    if result.finished_at is not None:
        payload["finished_at"] = result.finished_at.isoformat()
    return payload
