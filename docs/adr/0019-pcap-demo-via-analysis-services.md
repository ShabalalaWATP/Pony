# ADR-0019: Demo PCAPs via analysis services

## Context

Phase 2E needs demo data to include sample PCAPs and completed findings. The
standing upload route is intentionally gated by admin, recent TOTP, CSRF, and an
active engagement. The CLI seeder is a local development tool that writes the
rest of the synthetic dataset directly to Mongo and usually creates only the
ended demo engagement.

## Decision

The seeder persists demo PCAPs through the same backend service boundaries used
by upload and analysis: PCAP magic/size validation, GridFS byte storage, PCAP
metadata persistence, and `PcapAnalyzer`. It does not call the HTTP upload route,
and it does not write GridFS collections directly.

Demo capture ids are deterministic and attached to the ended demo engagement.
`--clean` removes those deterministic PCAP metadata, bytes, analysis runs, and
findings alongside the existing synthetic records.

## Consequences

- The upload route gate stack remains unchanged.
- Demo seed exercises the same persistence and analyzer contracts operators use.
- Demo captures can be re-seeded idempotently without duplicating metadata or
  findings.
- Local environments without `tshark` still seed records, but the analyzer
  records failed-filter placeholders instead of crashing the seeder.

## Alternatives Considered

- **HTTP self-call from the CLI.** Rejected because it would require fabricating a
  browser auth, CSRF, and recent-TOTP context or weakening the route for seed
  automation.
- **Direct GridFS writes.** Rejected because it bypasses validation and analysis
  orchestration, which are the contracts this demo path should exercise.
- **Bundling only PCAP metadata.** Rejected because reports and future frontend
  capture views need completed analysis runs and findings.
