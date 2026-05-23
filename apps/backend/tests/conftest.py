# SPDX-License-Identifier: AGPL-3.0-only
"""Pytest fixtures for backend API tests."""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence

import httpx
import pytest_asyncio

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.dependencies import reset_auth_rate_limiters
from cheeky_pony_backend.infra.in_memory_store import InMemoryStore
from cheeky_pony_backend.infra.pcap_analysis_store import InMemoryPcapAnalysisStore
from cheeky_pony_backend.infra.pcap_store import InMemoryPcapStore
from cheeky_pony_backend.main import create_app
from cheeky_pony_backend.pcap.tshark import TsharkResult


class BackendClient:
    """Test client bundle exposing the app store."""

    def __init__(
        self,
        client: httpx.AsyncClient,
        store: InMemoryStore,
        pcap_store: InMemoryPcapStore | None = None,
        pcap_analysis_store: InMemoryPcapAnalysisStore | None = None,
    ) -> None:
        self.client = client
        self.store = store
        self.pcap_store = pcap_store
        self.pcap_analysis_store = pcap_analysis_store


class TestTsharkRuntime:
    """Deterministic tshark runtime for API tests."""

    async def run_filter(
        self,
        *,
        pcap_fd: int,
        filter_args: Sequence[str],
        timeout_seconds: int,
    ) -> TsharkResult:
        """Return representative parser output."""

        del pcap_fd, timeout_seconds
        args = " ".join(str(part) for part in filter_args)
        if "io,phs" in args:
            return TsharkResult(
                stdout="eth frames:3 bytes:300\n  ip frames:2 bytes:200\n",
                stderr="",
            )
        if "conv" in args:
            return TsharkResult(stdout="aa:aa <-> bb:bb 1 120\n", stderr="")
        return TsharkResult(stdout=_deauth_rows(), stderr="")


@pytest_asyncio.fixture
async def backend_client() -> AsyncIterator[BackendClient]:
    """Create an isolated backend app and HTTP client.

    Yields:
        Backend client bundle.
    """

    settings = Settings(
        env="test",
        cookie_secure=False,
        jwt_secret="j" * 32,
        bootstrap_token="bootstrap-" + "token-test",
        use_in_memory_store=True,
    )
    reset_auth_rate_limiters()
    store = InMemoryStore()
    pcap_store = InMemoryPcapStore()
    pcap_analysis_store = InMemoryPcapAnalysisStore()
    app = create_app(
        settings=settings,
        store=store,
        pcap_store=pcap_store,
        pcap_analysis_store=pcap_analysis_store,
        tshark_runtime=TestTsharkRuntime(),
    )
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield BackendClient(client, store, pcap_store, pcap_analysis_store)


def _deauth_rows() -> str:
    return "\n".join(
        f"{1000 + index}\taa:bb:cc:dd:ee:ff\tff:ff:ff:ff:ff:ff\taa:bb:cc:dd:ee:ff"
        for index in range(10)
    )
