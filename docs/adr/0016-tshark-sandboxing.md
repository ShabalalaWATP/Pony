# ADR 0016: Sandboxed tshark Analysis

## Context

Phase 2B analyzes operator-uploaded PCAPs. PCAPs are attacker-influenced binary
inputs parsed by tshark, a large native-code parser with protocol dissectors and
extension hooks. The backend needs useful structured findings without exposing
operators to raw tool output or letting request bodies control tshark arguments.

## Decision

Run tshark only through a backend-owned runtime that builds argv arrays from a
reviewed filter library. The API exposes `POST /pcaps/{id}/analyze` with no
filter body. Each invocation applies `-n`, `--disable-protocol lua`,
`--no-extcap`, read-only capture input, stdout/stderr caps, memory and CPU
limits where supported, and an asyncio wall-clock timeout.

Analysis is queued through the existing worker boundary. The PCAP store atomically
claims a capture by moving it to `analyzing`, so a second concurrent analysis for
the same capture returns `409`. Filter failures are stored as bounded structured
failure findings and do not prevent later filters from running.

Backend startup probes `tshark -v` and requires `CHEEKY_PONY_TSHARK_MIN_VERSION`
or newer outside the test environment. The backend Docker image and CI install
tshark so the same dependency is exercised in tests and deployed containers.

## Consequences

- Operators receive structured protocol hierarchy, conversation, and deauth-burst
  findings without raw tshark output.
- The API cannot become a tshark expression injection surface without an explicit
  schema change.
- Local non-Docker backend development now needs tshark installed or a configured
  `CHEEKY_PONY_TSHARK_PATH`.
- Resource limits are best-effort on non-POSIX platforms; the wall-clock timeout
  and output caps still apply.

## Alternatives Considered

- Operator-supplied filters: rejected because tshark display filters are a parser
  and injection surface that would need a separate policy engine.
- Persisting raw tshark stdout for the frontend: rejected because it leaks
  unnecessary capture detail and creates an unstable UI contract.
- Inline analysis in the request handler: rejected because tshark work can be
  slow and needs status tracking, retries, and a one-run-at-a-time guard.
