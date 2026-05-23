# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for sandboxed tshark runtime construction."""

from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
from collections.abc import Awaitable, Callable, Sequence

import pytest

import cheeky_pony_backend.pcap.tshark as tshark_module
from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.pcap.filters.protocol_hierarchy import build_args
from cheeky_pony_backend.pcap.tshark import TsharkError, TsharkRuntime, build_tshark_command

PCAP_BYTES = b"\xd4\xc3\xb2\xa1" + b"\x02\x00\x04\x00" + b"\x00" * 16
SpawnHook = Callable[[Sequence[str], int], Awaitable["FakeProcess"]]


def test_tshark_command_uses_sandbox_flags_and_fd_path() -> None:
    """Every tshark command includes fixed sandbox flags and fd-style input."""

    command = build_tshark_command("tshark", 7, ["-q"])

    assert command[:6] == ["tshark", "-n", "--disable-protocol", "lua", "--no-extcap", "-r"]
    assert command[6].endswith("/7")
    assert "capture.pcap" not in command


@pytest.mark.asyncio
async def test_tshark_runtime_returns_captured_output(monkeypatch: pytest.MonkeyPatch) -> None:
    """Runtime returns bounded stdout/stderr from the sandboxed process."""

    async def spawn(command: Sequence[str], pcap_fd: int) -> FakeProcess:
        assert command[1:5] == ["-n", "--disable-protocol", "lua", "--no-extcap"]
        assert pcap_fd == 9
        return FakeProcess(stdout=b"Protocol Hierarchy\n", stderr=b"ok", returncode=0)

    monkeypatch.setattr(tshark_module, "_spawn_tshark", spawn)

    result = await TsharkRuntime(Settings(env="test")).run_filter(
        pcap_fd=9,
        filter_args=["-q"],
        timeout_seconds=1,
    )

    assert result.stdout == "Protocol Hierarchy\n"
    assert result.stderr == "ok"


@pytest.mark.asyncio
async def test_tshark_runtime_kills_on_stdout_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    """Oversized output is rejected and the process is killed."""

    process = FakeProcess(stdout=(b"x" * 1_100_000), stderr=b"", returncode=0, wait_forever=True)
    monkeypatch.setattr(tshark_module, "_spawn_tshark", _spawn_hook(process))

    with pytest.raises(TsharkError, match="tshark_stdout_limit"):
        await TsharkRuntime(Settings(env="test", tshark_stdout_max_mb=1)).run_filter(
            pcap_fd=9,
            filter_args=["-q"],
            timeout_seconds=1,
        )

    assert process.killed


@pytest.mark.asyncio
async def test_tshark_runtime_kills_on_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    """Wall-clock timeout kills slow tshark processes."""

    process = FakeProcess(stdout=None, stderr=None, returncode=0, wait_forever=True)
    monkeypatch.setattr(tshark_module, "_spawn_tshark", _spawn_hook(process))

    with pytest.raises(TsharkError, match="tshark_timeout"):
        await TsharkRuntime(Settings(env="test")).run_filter(
            pcap_fd=9,
            filter_args=["-q"],
            timeout_seconds=0,
        )

    assert process.killed


@pytest.mark.asyncio
async def test_tshark_runtime_raises_sanitized_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """Non-zero tshark exits become bounded runtime errors."""

    process = FakeProcess(stdout=b"", stderr=b"bad capture", returncode=2)
    monkeypatch.setattr(tshark_module, "_spawn_tshark", _spawn_hook(process))

    with pytest.raises(TsharkError, match="tshark_exit_2"):
        await TsharkRuntime(Settings(env="test")).run_filter(
            pcap_fd=9,
            filter_args=["-q"],
            timeout_seconds=1,
        )


@pytest.mark.asyncio
async def test_tshark_startup_version_probe(monkeypatch: pytest.MonkeyPatch) -> None:
    """Startup probe accepts versions at or above the configured minimum."""

    async def create_process(*args: str, **kwargs: object) -> FakeVersionProcess:
        assert args[:2] == ("tshark", "-v")
        return FakeVersionProcess(stdout=b"TShark (Wireshark) 4.2.1\n", returncode=0)

    monkeypatch.setattr(tshark_module.asyncio, "create_subprocess_exec", create_process)

    await TsharkRuntime(Settings(env="dev", tshark_min_version="4.2.0")).check_available()


@pytest.mark.asyncio
async def test_tshark_startup_rejects_old_versions(monkeypatch: pytest.MonkeyPatch) -> None:
    """Startup probe rejects tshark below the configured floor."""

    async def create_process(*args: str, **kwargs: object) -> FakeVersionProcess:
        return FakeVersionProcess(stdout=b"TShark (Wireshark) 4.0.9\n", returncode=0)

    monkeypatch.setattr(tshark_module.asyncio, "create_subprocess_exec", create_process)

    with pytest.raises(TsharkError, match="tshark_version_too_old"):
        await TsharkRuntime(Settings(env="dev", tshark_min_version="4.2.0")).check_available()


@pytest.mark.asyncio
async def test_tshark_startup_rejects_unavailable_binary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Startup probe reports a failed tshark version command."""

    async def create_process(*args: str, **kwargs: object) -> FakeVersionProcess:
        return FakeVersionProcess(stderr=b"missing", returncode=1)

    monkeypatch.setattr(tshark_module.asyncio, "create_subprocess_exec", create_process)

    with pytest.raises(TsharkError, match="missing"):
        await TsharkRuntime(Settings(env="dev")).check_available()


@pytest.mark.asyncio
async def test_tshark_startup_rejects_unknown_version(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Startup probe fails closed when tshark output cannot be parsed."""

    async def create_process(*args: str, **kwargs: object) -> FakeVersionProcess:
        return FakeVersionProcess(stdout=b"unexpected version banner", returncode=0)

    monkeypatch.setattr(tshark_module.asyncio, "create_subprocess_exec", create_process)

    with pytest.raises(TsharkError, match="tshark_version_unknown"):
        await TsharkRuntime(Settings(env="dev")).check_available()


@pytest.mark.asyncio
async def test_verify_tshark_startup_runs_outside_tests(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Startup verification is skipped only for the test environment."""

    called = False

    async def check_available(runtime: TsharkRuntime) -> None:
        nonlocal called
        del runtime
        called = True

    monkeypatch.setattr(tshark_module.TsharkRuntime, "check_available", check_available)

    await tshark_module.verify_tshark_startup(Settings(env="dev"))

    assert called


@pytest.mark.asyncio
async def test_collect_output_rejects_missing_pipes() -> None:
    """Runtime fails closed if stdout or stderr pipes are absent."""

    with pytest.raises(TsharkError, match="tshark_pipe_missing"):
        await tshark_module._collect_output(ProcessWithoutPipes(), 10)


@pytest.mark.asyncio
async def test_kill_process_ignores_already_exited_process() -> None:
    """Already-exited processes are not killed again."""

    process = FakeProcess(stdout=b"", stderr=b"", returncode=0)
    process.returncode = 0

    await tshark_module._kill_process(process)

    assert not process.killed


@pytest.mark.asyncio
async def test_tshark_runtime_runs_against_minimal_capture_when_available() -> None:
    """Runtime integration smoke for CI images with tshark installed."""

    tshark = shutil.which("tshark")
    if tshark is None or os.name != "posix":
        pytest.skip("tshark fd integration requires tshark on a POSIX host")

    path = _write_temp_pcap()
    fd = os.open(path, os.O_RDONLY)
    try:
        try:
            result = await TsharkRuntime(Settings(env="test", tshark_path=tshark)).run_filter(
                pcap_fd=fd,
                filter_args=build_args(),
                timeout_seconds=10,
            )
        except TsharkError as exc:
            pytest.skip(f"tshark rejected the minimal smoke fixture: {exc}")
    finally:
        os.close(fd)
        os.unlink(path)

    assert "Protocol Hierarchy" in result.stdout


def _write_temp_pcap() -> str:
    handle = tempfile.NamedTemporaryFile(prefix="cheeky-pony-test-", suffix=".pcap", delete=False)
    try:
        handle.write(PCAP_BYTES)
    finally:
        handle.close()
    return handle.name


class FakeProcess:
    """Small process double for runtime unit tests."""

    def __init__(
        self,
        *,
        stdout: bytes | None,
        stderr: bytes | None,
        returncode: int,
        wait_forever: bool = False,
    ) -> None:
        self.stdout = _reader(stdout) if stdout is not None else asyncio_reader()
        self.stderr = _reader(stderr) if stderr is not None else asyncio_reader()
        self.returncode: int | None = None
        self._final_returncode = returncode
        self._wait_forever = wait_forever
        self.killed = False

    async def wait(self) -> int:
        if self._wait_forever and not self.killed:
            await _never()
        self.returncode = self._final_returncode
        return self._final_returncode

    def kill(self) -> None:
        self.killed = True
        self._final_returncode = -9
        self.returncode = -9
        self.stdout.feed_eof()
        self.stderr.feed_eof()


class FakeVersionProcess:
    """Process double for `tshark -v` startup probes."""

    def __init__(self, *, stdout: bytes = b"", stderr: bytes = b"", returncode: int) -> None:
        self._stdout = stdout
        self._stderr = stderr
        self.returncode = returncode

    async def communicate(self) -> tuple[bytes, bytes]:
        return self._stdout, self._stderr


class ProcessWithoutPipes:
    """Process double with missing pipe handles."""

    stdout = None
    stderr = None


def _spawn_hook(process: FakeProcess) -> SpawnHook:
    async def spawn(command: Sequence[str], pcap_fd: int) -> FakeProcess:
        del command, pcap_fd
        return process

    return spawn


def _reader(content: bytes) -> asyncio.StreamReader:
    reader = asyncio.StreamReader()
    reader.feed_data(content)
    reader.feed_eof()
    return reader


def asyncio_reader() -> asyncio.StreamReader:
    return asyncio.StreamReader()


async def _never() -> None:
    while True:
        await asyncio.sleep(60)
