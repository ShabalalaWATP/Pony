# ADR 0013: Anomaly Score and Evil-Twin Candidates

## Context

Operators need attention cues for APs that look risky without shipping packet
payloads off-box or waiting for a later ML pipeline. The backend already has the
inputs needed for a conservative first pass: SSID, encryption, OUI vendor,
recent events, and current client associations.

## Decision

Compute AP anomaly scores on read using pure functions in `domain/anomaly.py`.
The API adds response-only `anomaly_score` and `anomaly_reasons` fields to access
point reads. Scores are additive and clamped to `0..100`; each contribution
keeps a reason, weight, and short operator-facing detail.

Expose `GET /api/v1/access_points/evil-twin-candidates` as an authenticated
operator read route. It groups APs by exact SSID and reports same-SSID groups
where vendor evidence differs and at least one AP looks corporate or public.
Calls are written to audit with `access_points.evil_twin_candidates.read`.

## Consequences

- Scores are deterministic, local-only, and easy to test.
- No new persisted fields or migrations are required.
- The endpoint exposes derived defensive intelligence only to authenticated
  operators.
- The first version is intentionally conservative; future rules can add new
  contribution reasons without changing stored records.

## Alternatives Considered

- Persisting anomaly scores: rejected because weights will change as evidence
  improves, and persisted guesses would drift from current rules.
- ML or LLM scoring: rejected for Phase 1 because anomaly detection is local-only
  and this phase adds no external calls.
- Frontend-only scoring: rejected because every client would duplicate security
  heuristics and event-window logic.
