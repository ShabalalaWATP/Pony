# Third-Party Notices

## Wireshark Manufacturer Database

Cheeky Pony includes a trimmed derivative of Wireshark's `manuf.txt`
manufacturer-prefix database at `apps/backend/data/manuf.tsv`.

- Project: Wireshark
- Source: `manuf.txt`
- Copyright holder: Wireshark Foundation and contributors
- License: CC-BY-SA-4.0
- Usage: OUI prefix to vendor-name lookup for local API response enrichment

The bundled table is reduced to the fields Cheeky Pony uses: OUI prefix, short
vendor, and long vendor. No packet data or operator telemetry is sourced from
Wireshark.
