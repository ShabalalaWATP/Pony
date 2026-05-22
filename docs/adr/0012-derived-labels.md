# ADR 0012: Local Derived Labels

## Context

Operators need quick, legible AP and client badges without sending telemetry to an
external model or persisting guesses as facts. Existing records already contain
SSID, encryption, vendor, probe history, and association timing, which are enough
for conservative first-pass labels.

## Decision

Compute access point and client labels on read using pure functions in
`domain/labelling.py`. API response serializers add `label` and
`label_confidence`; repository records remain unchanged. Low-confidence labels
are suppressed to `unknown` using `CHEEKY_PONY_LABEL_CONFIDENCE_THRESHOLD`
defaulting to `0.6`.

Rules are explicit and declarative: SSID patterns identify public, corporate,
mobile-hotspot, IoT, and personal APs; vendor/probe/association heuristics
identify mobile, laptop, IoT, and wearable clients.

## Consequences

- Labels are deterministic, testable, and local-only.
- Refreshing or tuning rules does not require database migrations.
- The backend can expose confidence to the frontend while avoiding badges for
  weak matches.
- Labels are hints, not evidence; later anomaly scoring must keep its own
  reasons and weights.

## Alternatives Considered

- Persisting labels: rejected because labels are derived presentation metadata and
  may change as rules improve.
- LLM-generated labels: rejected for Phase 1 because this phase forbids egress and
  operator data should remain local.
- Frontend-only labels: rejected because every client would duplicate heuristic
  logic and tests.
