# SPDX-License-Identifier: AGPL-3.0-only
"""Pytest fixtures for backend API tests."""

from __future__ import annotations

from collections.abc import AsyncIterator

import httpx
import pytest_asyncio

from cheeky_pony_backend.config import Settings
from cheeky_pony_backend.dependencies import reset_auth_rate_limiters
from cheeky_pony_backend.infra.in_memory_store import InMemoryStore
from cheeky_pony_backend.infra.pcap_store import InMemoryPcapStore
from cheeky_pony_backend.main import create_app


class BackendClient:
    """Test client bundle exposing the app store."""

    def __init__(
        self,
        client: httpx.AsyncClient,
        store: InMemoryStore,
        pcap_store: InMemoryPcapStore | None = None,
    ) -> None:
        self.client = client
        self.store = store
        self.pcap_store = pcap_store


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
    app = create_app(settings=settings, store=store, pcap_store=pcap_store)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield BackendClient(client, store, pcap_store)
