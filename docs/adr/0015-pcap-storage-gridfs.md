# ADR 0015: PCAP Storage in GridFS

## Context

Phase 2 adds operator-uploaded capture files before tshark analysis exists. PCAPs
are binary, engagement-scoped, potentially large, and must not be exposed through
a raw download route. The backend already uses MongoDB for engagement-scoped
records, and the upload path needs metadata queries plus byte storage.

## Decision

Store PCAP metadata in a `pcaps` collection and capture bytes in MongoDB GridFS.
The API validates magic bytes and size before writing either metadata or GridFS
content. The `PcapStore` interface is separate from the general application
`Store` so later analysis code can read capture bytes without adding binary-file
concerns to every repository implementation.

Duplicate uploads are stored independently. Operators may intentionally upload
the same capture twice during a lab, and each upload is a separate audited action.
Deduplication can be added later behind the same metadata shape if storage cost
becomes material.

## Consequences

- PCAP lifecycle reads stay naturally scoped by engagement id.
- GridFS keeps large binary chunks out of normal MongoDB documents.
- There is no original-capture download route in this phase.
- Deleting a PCAP removes both metadata and the GridFS object.

## Alternatives Considered

- Filesystem storage: rejected because compose and future deployments would need
  a new durable volume contract and path-hardening surface.
- S3-compatible object storage: rejected for this phase because it adds an
  external dependency and credential surface.
- Hash-based deduplication: rejected for now because it weakens audit clarity for
  repeated operator uploads.
