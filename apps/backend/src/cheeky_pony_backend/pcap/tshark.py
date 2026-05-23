# SPDX-License-Identifier: AGPL-3.0-only
"""Sandboxed tshark subprocess runtime."""

from __future__ import annotations

import asyncio
import os
import re
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from cheeky_pony_backend.config import Settings

_STDERR_CAP_BYTES = 1024 * 1024
_VERSION_PATTERN = re.compile(r"TShark \(Wireshark\) (?P<version>\d+\.\d+\.\d+)")


class TsharkError(Exception):
    """Raised when tshark fails or violates runtime limits."""

    def __init__(self, reason: str) -> None:
        self.reason = reason[:200] or "tshark_failed"
        super().__init__(self.reason)


@dataclass(frozen=True)
class TsharkResult:
    """Captured tshark output."""

    stdout: str
    stderr: str


class TsharkRunner(Protocol):
    """Runtime boundary for curated tshark filters."""

    async def run_filter(
        self,
        *,
        pcap_fd: int,
        filter_args: Sequence[str],
        timeout_seconds: int,
    ) -> TsharkResult:
        """Run one curated tshark filter."""


class TsharkRuntime:
    """Run tshark with fixed sandbox flags and bounded output."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def check_available(self) -> None:
        """Verify tshark is installed and meets the configured minimum version."""

        proc = await asyncio.create_subprocess_exec(
            self._settings.tshark_path,
            "-v",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise TsharkError(_decode(stderr) or "tshark_unavailable")
        version = _parse_version(_decode(stdout))
        if version is None:
            raise TsharkError("tshark_version_unknown")
        if _version_tuple(version) < _version_tuple(self._settings.tshark_min_version):
            raise TsharkError("tshark_version_too_old")

    async def run_filter(
        self,
        *,
        pcap_fd: int,
        filter_args: Sequence[str],
        timeout_seconds: int,
    ) -> TsharkResult:
        """Run a curated filter against a read-only capture file descriptor."""

        command = build_tshark_command(self._settings.tshark_path, pcap_fd, filter_args)
        proc = await _spawn_tshark(command, pcap_fd)
        try:
            stdout, stderr = await asyncio.wait_for(
                _collect_output(proc, self._settings.tshark_stdout_max_mb * 1024 * 1024),
                timeout=timeout_seconds,
            )
        except TimeoutError as exc:
            await _kill_process(proc)
            raise TsharkError("tshark_timeout") from exc
        except TsharkError:
            await _kill_process(proc)
            raise
        if proc.returncode != 0:
            raise TsharkError(f"tshark_exit_{proc.returncode}")
        return TsharkResult(stdout=_decode(stdout), stderr=_decode(stderr))


def build_tshark_command(
    tshark_path: str,
    pcap_fd: int,
    filter_args: Sequence[str],
) -> list[str]:
    """Build the fixed tshark argv used by every filter."""

    return [
        tshark_path,
        "-n",
        "--disable-protocol",
        "lua",
        "--no-extcap",
        "-r",
        _fd_path(pcap_fd),
        *filter_args,
    ]


async def verify_tshark_startup(settings: Settings) -> None:
    """Run the startup tshark probe outside tests."""

    if settings.env.lower() == "test":
        return
    await TsharkRuntime(settings).check_available()


async def _spawn_tshark(
    command: Sequence[str],
    pcap_fd: int,
) -> asyncio.subprocess.Process:
    if os.name == "posix":
        return await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            pass_fds=(pcap_fd,),
            preexec_fn=_apply_resource_limits,
        )
    return await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )


async def _collect_output(
    proc: asyncio.subprocess.Process,
    stdout_cap_bytes: int,
) -> tuple[bytes, bytes]:
    if proc.stdout is None or proc.stderr is None:
        raise TsharkError("tshark_pipe_missing")
    stdout_task = asyncio.create_task(_read_capped(proc.stdout, stdout_cap_bytes))
    stderr_task = asyncio.create_task(_read_capped(proc.stderr, _STDERR_CAP_BYTES))
    wait_task = asyncio.create_task(proc.wait())
    try:
        stdout, stderr, _ = await asyncio.gather(stdout_task, stderr_task, wait_task)
        return stdout, stderr
    finally:
        for task in (stdout_task, stderr_task, wait_task):
            if not task.done():
                task.cancel()


async def _read_capped(reader: asyncio.StreamReader, cap_bytes: int) -> bytes:
    chunks: list[bytes] = []
    size = 0
    while chunk := await reader.read(65536):
        size += len(chunk)
        if size > cap_bytes:
            raise TsharkError("tshark_stdout_limit")
        chunks.append(chunk)
    return b"".join(chunks)


def _fd_path(pcap_fd: int) -> str:
    if sys.platform.startswith("linux"):
        return f"/proc/self/fd/{pcap_fd}"
    return f"/dev/fd/{pcap_fd}"


async def _kill_process(proc: asyncio.subprocess.Process) -> None:
    if proc.returncode is not None:
        return
    proc.kill()
    await proc.wait()


def _apply_resource_limits() -> None:
    if sys.platform == "win32":
        return
    import resource

    memory_bytes = 512 * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
    resource.setrlimit(resource.RLIMIT_CPU, (60, 60))


def _decode(content: bytes) -> str:
    return content.decode("utf-8", errors="replace")


def _parse_version(output: str) -> str | None:
    match = _VERSION_PATTERN.search(output)
    return match.group("version") if match else None


def _version_tuple(version: str) -> tuple[int, int, int]:
    major, minor, patch = version.split(".", 2)
    return int(major), int(minor), int(patch)
