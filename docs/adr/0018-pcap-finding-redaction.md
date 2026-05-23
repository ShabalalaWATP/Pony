# ADR 0018: PCAP Finding Redaction

## Context

Phase 2D adds DNS, TLS SNI, and DHCP findings from uploaded captures. These
fields are useful for local operator triage, but DNS queries and SNI names can
include internal infrastructure names that should not leak into screenshots,
exports, or downstream reports.

## Decision

The analyzer keeps the tshark filter library hardcoded and adds a backend
redaction layer before findings are persisted. DNS query names and TLS SNI names
matching `CHEEKY_PONY_PCAP_INTERNAL_HOSTNAME_SUFFIXES` are bucketed as
`INTERNAL_HOSTNAME_REDACTED`. The default suffixes are `.local`, `.internal`, and
`.corp`; operators can extend or replace the list with a comma-separated env
value.

DHCP findings expose bounded hostnames, vendor class identifiers, requested
options, and vendor enrichment. Vendor names come from existing Client records
first, then the embedded OUI table. Unknown vendors stay unknown instead of
triggering external lookups.

## Consequences

- PCAP analysis remains local-only and performs no outbound enrichment calls.
- Internal hostnames are redacted before storage, not just before display.
- Findings stay structured and bounded; raw tshark output remains unavailable to
  operators.
- The OpenAPI schema exposes the new evidence models so the future frontend can
  render them without parsing free-form text.

## Alternatives Considered

- Redacting in the frontend: rejected because raw internal names would still be
  persisted and could leak through APIs or reports.
- Hiding all DNS and SNI names: rejected because public destination summaries are
  a major part of capture triage.
- External threat-intel or domain categorization: rejected for Phase 2 because
  this phase explicitly adds no outbound network calls.
