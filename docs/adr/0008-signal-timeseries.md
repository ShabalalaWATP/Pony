# ADR 0008: Signal time-series scaling — interim cap, future TimescaleDB

## Status

Accepted

## Context

Access points and clients currently expose `signal_history` arrays for frontend
sparklines. A real sensor sampling at 1 Hz can produce about 86,000 samples per
entity per day, which will eventually push MongoDB documents toward the 16 MB
limit and make read paths heavy.

The product still needs simple, inline sparklines now, but longer chart ranges
and fleet-scale storage need a time-series store rather than larger MongoDB
documents.

## Decision

Keep MongoDB as the source of truth for current entity snapshots, but cap inline
`signal_history` arrays at 200 samples at the repository boundary. New samples
are appended FIFO-style, with oldest samples evicted first.

The backend introduces a `SignalsRepo` seam with MongoDB as the current adapter.
That seam is the future replacement point for TimescaleDB when either of these
triggers arrives:

- Operators request charting over weeks rather than sparkline-scale recency.
- Production-like deployments track more than 10,000 AP/client entities.

The future migration stores signal samples in a TimescaleDB hypertable keyed by
entity kind, entity id, and sample time. MongoDB keeps only the current snapshot
and a short recent cache for API compatibility. Backfill reads existing capped
Mongo arrays into TimescaleDB, then new writes dual-write behind `SignalsRepo`
until reads can switch.

## Consequences

MongoDB documents stay bounded while the existing API remains additive and
compatible. The cap intentionally favors recent UI signal shape over historical
precision.

TimescaleDB is not implemented in this PR; the seam and cap make the later
migration explicit without adding unused infrastructure.

## Alternatives Considered

- MongoDB bucket pattern: reduces document growth but still keeps time-series
  query concerns inside the snapshot database.
- TTL-only storage: bounds retention but does not support weekly charting or
  efficient entity/time range reads.
- InfluxDB: strong time-series fit, but adds a separate query model and
  operational surface where Postgres-compatible TimescaleDB is enough.
