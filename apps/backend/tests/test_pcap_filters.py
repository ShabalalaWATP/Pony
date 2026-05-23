# SPDX-License-Identifier: AGPL-3.0-only
"""Tests for curated PCAP filter parsers."""

from __future__ import annotations

from hypothesis import given
from hypothesis import strategies as st

from cheeky_pony_backend.domain.oui_lookup import OuiService, OuiVendor
from cheeky_pony_backend.pcap.filters import (
    beacons,
    conversations,
    deauth,
    dhcp,
    dns,
    eapol,
    probe_responses,
    protocol_hierarchy,
    tls_sni,
)
from cheeky_pony_backend.pcap.hostname_redaction import INTERNAL_HOSTNAME_REDACTED
from cheeky_pony_shared import AccessPoint, Client


def test_protocol_hierarchy_parser_extracts_rows() -> None:
    """Protocol hierarchy rows are parsed into bounded evidence."""

    evidence = protocol_hierarchy.parse("eth frames:3 bytes:300\n  ip frames:2 bytes:200\n")

    assert evidence.protocols[0].protocol == "eth"
    assert evidence.protocols[1].depth == 1
    assert evidence.protocols[1].frames == 2


def test_conversation_parser_keeps_top_talkers() -> None:
    """Conversation rows are sorted by byte volume."""

    evidence = conversations.parse("aa <-> bb 1 50\ncc <-> dd 2 250\n")

    assert evidence.conversations[0].left == "cc"
    assert evidence.conversations[0].bytes == 250


def test_deauth_parser_detects_bursts() -> None:
    """Ten deauths in five minutes produce one burst."""

    rows = "\n".join(f"{1000 + index}\taa\tff\taa:bb:cc:dd:ee:ff" for index in range(10))

    evidence = deauth.parse(rows)

    assert len(evidence.bursts) == 1
    assert evidence.bursts[0].bssid == "aa:bb:cc:dd:ee:ff"
    assert evidence.bursts[0].count == 10


def test_eapol_parser_groups_complete_handshake_and_lab_evidence() -> None:
    """EAPOL rows are grouped by BSSID/client with lab-gated evidence."""

    rows = "\n".join(
        [
            "1000\taa:bb:cc:dd:ee:ff\taa:bb:cc:dd:ee:ff\t11:22:33:44:55:66\t1\t"
            "00112233445566778899aabbccddeeff\t0102",
            "1001\taa:bb:cc:dd:ee:ff\t11:22:33:44:55:66\taa:bb:cc:dd:ee:ff\t2\t\t0304",
            "1002\taa:bb:cc:dd:ee:ff\taa:bb:cc:dd:ee:ff\t11:22:33:44:55:66\t3\t\t0506",
            "1003\taa:bb:cc:dd:ee:ff\t11:22:33:44:55:66\taa:bb:cc:dd:ee:ff\t4\t\t0708",
        ]
    )

    evidence = eapol.parse(rows)

    assert evidence.handshakes[0].complete is True
    assert evidence.handshakes[0].message_numbers == [1, 2, 3, 4]
    assert evidence.handshakes[0].pmkid == "00112233445566778899aabbccddeeff"
    assert evidence.handshakes[0].raw_bytes_b64 == ["AQI=", "AwQ=", "BQY=", "Bwg="]


def test_beacon_parser_flags_stored_channel_mismatch() -> None:
    """Beacon summaries are cross-referenced against stored AP metadata."""

    rows = "aa:bb:cc:dd:ee:ff\tCorpNet\t6\tprivacy;pmf\t00:11:22\t100"

    evidence = beacons.parse(
        rows,
        [
            AccessPoint(
                bssid="aa:bb:cc:dd:ee:ff",
                ssid="CorpNet",
                channel=11,
            )
        ],
    )

    assert evidence.networks[0].mismatches[0].field == "channel"
    assert evidence.networks[0].mismatches[0].observed == "6"
    assert evidence.networks[0].mismatches[0].stored == "11"


def test_probe_response_parser_detects_unbeaconed_ssid_response() -> None:
    """Probe responses to unbeaconed SSIDs are treated as anomalies."""

    rows = "\n".join(
        [
            "0x0008\taa:bb:cc:dd:ee:ff\taa:bb:cc:dd:ee:ff\tCorpNet",
            "0x0005\taa:bb:cc:dd:ee:ff\taa:bb:cc:dd:ee:ff\tFREE-WIFI",
        ]
    )

    evidence = probe_responses.parse(rows)

    assert evidence.anomalies[0].bssid == "aa:bb:cc:dd:ee:ff"
    assert evidence.anomalies[0].anomalous_ssids == ["FREE-WIFI"]


def test_dns_parser_redacts_internal_hostnames_and_counts_types() -> None:
    """DNS findings bucket internal hostnames and summarize query types."""

    rows = "\n".join(
        [
            "service.corp\t1",
            "www.example.com\t28",
            "odd.tldx\t16",
        ]
    )

    evidence = dns.parse(rows, [".corp"])

    assert evidence.total_queries == 3
    assert evidence.top_queries[0].name == INTERNAL_HOSTNAME_REDACTED
    assert {item.record_type for item in evidence.query_types} == {"A", "AAAA", "TXT"}
    assert evidence.unusual_tlds[0].name == "tldx"


def test_tls_sni_parser_redacts_configured_internal_suffix() -> None:
    """TLS SNI findings use the configured internal suffix list."""

    evidence = tls_sni.parse("portal.private\napi.example.com\n", [".private"])

    assert evidence.total_snis == 2
    assert [item.name for item in evidence.top_snis] == [
        INTERNAL_HOSTNAME_REDACTED,
        "api.example.com",
    ]


def test_dhcp_parser_enriches_known_client_and_oui_vendor() -> None:
    """DHCP observations prefer Client records, then fall back to OUI lookup."""

    rows = "\n".join(
        [
            "38:c9:86:00:00:01\tGalaxy-S22\tandroid-dhcp-13\t1,3,6",
            "b8:27:eb:00:00:02\traspberrypi\tudhcp\t1,3",
            "02:00:00:00:00:03\tunknown\t\t",
        ]
    )
    oui = OuiService(
        {
            "b8:27:eb": OuiVendor(
                prefix="b8:27:eb",
                short_vendor="Raspberry",
                long_vendor="Raspberry Pi Foundation",
            )
        }
    )

    evidence = dhcp.parse(
        rows,
        [Client(mac="38:C9:86:00:00:01", vendor_oui="Samsung Electronics")],
        oui,
    )

    by_mac = {client.client_mac: client for client in evidence.clients}
    assert by_mac["38:c9:86:00:00:01"].vendor_source == "client_record"
    assert by_mac["38:c9:86:00:00:01"].vendor == "Samsung Electronics"
    assert by_mac["b8:27:eb:00:00:02"].vendor_source == "oui_table"
    assert by_mac["02:00:00:00:00:03"].vendor_source == "unknown"


@given(st.text(max_size=2000))
def test_parsers_never_raise_on_arbitrary_text(payload: str) -> None:
    """Parser fuzz smoke: malformed tshark text is not fatal."""

    protocol_hierarchy.parse(payload)
    conversations.parse(payload)
    deauth.parse(payload)
    eapol.parse(payload)
    beacons.parse(payload)
    probe_responses.parse(payload)
    dns.parse(payload, [".corp"])
    tls_sni.parse(payload, [".corp"])
    dhcp.parse(payload, [], OuiService({}))
