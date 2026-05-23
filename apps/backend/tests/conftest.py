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
        if "eapol" in args:
            return TsharkResult(stdout=_eapol_rows(include_lab_evidence="pmkid" in args), stderr="")
        if "0x0008 || wlan.fc.type_subtype == 0x0005" in args:
            return TsharkResult(stdout=_probe_response_rows(), stderr="")
        if "0x0008" in args:
            return TsharkResult(stdout=_beacon_rows(), stderr="")
        if "dns.qry.name" in args:
            return TsharkResult(stdout=_dns_rows(), stderr="")
        if "tls.handshake.extensions_server_name" in args:
            return TsharkResult(stdout=_tls_sni_rows(), stderr="")
        if "bootp.hw.mac_addr" in args:
            return TsharkResult(stdout=_dhcp_rows(), stderr="")
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


def _eapol_rows(*, include_lab_evidence: bool) -> str:
    base = [
        "1000\taa:bb:cc:dd:ee:ff\taa:bb:cc:dd:ee:ff\t11:22:33:44:55:66\t1",
        "1001\taa:bb:cc:dd:ee:ff\t11:22:33:44:55:66\taa:bb:cc:dd:ee:ff\t2",
        "1002\taa:bb:cc:dd:ee:ff\taa:bb:cc:dd:ee:ff\t11:22:33:44:55:66\t3",
        "1003\taa:bb:cc:dd:ee:ff\t11:22:33:44:55:66\taa:bb:cc:dd:ee:ff\t4",
    ]
    if not include_lab_evidence:
        return "\n".join(base)
    return "\n".join(f"{row}\t00112233445566778899aabbccddeeff\t01020304" for row in base)


def _beacon_rows() -> str:
    return "aa:bb:cc:dd:ee:ff\tCorpNet\t6\tprivacy;short-preamble\t00:11:22\t100"


def _probe_response_rows() -> str:
    return "\n".join(
        [
            "0x0008\taa:bb:cc:dd:ee:ff\taa:bb:cc:dd:ee:ff\tCorpNet",
            "0x0005\taa:bb:cc:dd:ee:ff\taa:bb:cc:dd:ee:ff\tFREE-WIFI",
        ]
    )


def _dns_rows() -> str:
    return "\n".join(
        [
            "www.example.com\t1",
            "intranet.corp\t1",
            "printer.local\t28",
            "odd.tldx\t16",
        ]
    )


def _tls_sni_rows() -> str:
    return "\n".join(["api.example.com", "portal.internal"])


def _dhcp_rows() -> str:
    return "38:c9:86:00:00:01\tGalaxy-S22\tandroid-dhcp-13\t1,3,6,15"
