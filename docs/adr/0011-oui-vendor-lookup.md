# ADR 0011: OUI Vendor Lookup

## Context

Operators need AP and client MACs to carry recognizable vendor names without
calling external services. Stored `vendor_oui` values can be absent, stale, or
sensor-specific, and the frontend needs a stable field it can render without
guessing.

## Decision

Bundle a trimmed Wireshark `manuf.txt` derivative as
`apps/backend/data/manuf.tsv`, load it once at backend startup, and enrich
access point and client API responses with a derived `vendor_resolved` field.
When a MAC prefix resolves, the response `vendor_oui` is also presented as the
resolved long vendor name, while the persisted entity remains unchanged.

Expose `GET /api/v1/oui/{prefix}` without authentication because it serves only
public manufacturer-prefix data. The route is still rate-limited with the
standard in-process throttle to avoid low-value enumeration traffic.

## Consequences

- No outbound network calls are introduced.
- Entity models stay focused on persisted facts; API serializers own
  presentation enrichment.
- The OUI table must be refreshed intentionally when operators need broader
  vendor coverage.
- Locally administered demo MACs such as `02:00:*` correctly return no resolved
  vendor unless the stored synthetic profile already supplies one.

## Alternatives Considered

- External OUI API lookup: rejected because Phase 1 forbids new outbound
  dependencies and lookup availability would affect local demos.
- Persisting resolved vendors on write: rejected because the source table can be
  refreshed independently and derived presentation data should not rewrite sensor
  facts.
- Frontend-only lookup table: rejected because every client would need to carry
  duplicate lookup logic and table attribution.
