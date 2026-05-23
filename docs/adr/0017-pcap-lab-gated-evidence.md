# ADR 0017: PCAP Lab-Gated Evidence

## Context

Phase 2C adds WiFi-specific findings from uploaded PCAPs. Handshake metadata is
useful in normal defensive review, but raw EAPOL key data and PMKID material can
support offline cracking workflows. Cheeky Pony must keep that evidence behind
the same lab-mode posture used for active modules while still surfacing benign
metadata outside lab mode.

## Decision

The EAPOL filter always extracts structured metadata: BSSID, client MAC, observed
message numbers, message count, and completion status. The filter only requests
PMKID and raw EAPOL key data from tshark when `CHEEKY_PONY_LAB_MODE=true`.

Finding reads also redact lab-gated EAPOL fields when lab mode is off. This means
older findings generated while lab mode was enabled cannot leak raw evidence if
the backend later restarts with lab mode disabled.

Beacon and probe-response findings remain normal structured analysis evidence.
They contain SSIDs, channel/capability summaries, and anomaly reasons, but no raw
frame bytes.

## Consequences

- Operators can review handshake presence and completion state in all modes.
- PMKID and raw EAPOL evidence never appears in API responses unless lab mode is
  currently enabled.
- The OpenAPI contract includes optional lab-only fields, but responses omit them
  when redacted.
- The analyzer has a small response-time redaction layer in addition to
  generation-time filtering.

## Alternatives Considered

- Never extracting raw handshake evidence: rejected because lab workflows need a
  future-safe structured place for the data.
- Persisting raw tshark output and redacting in the frontend: rejected because it
  leaks too much capture detail and violates the structured-finding contract.
- A per-request `include_raw` flag: rejected because evidence disclosure should
  be controlled by backend lab posture, not an operator-supplied query parameter.
