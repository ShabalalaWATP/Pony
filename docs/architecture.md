# Architecture

Cheeky Pony is split into three deployable surfaces:

- `sensor-agent`: a Raspberry Pi service that talks to local WiFi tooling, streams
  normalized passive events, exposes local health/capability endpoints, and receives
  backend commands over the authenticated sensor WebSocket.
- `backend`: FastAPI, MongoDB, Redis, in-process development brokers, and worker
  boundaries on the operator PC.
- `frontend`: a React operator console that consumes REST, the operator WebSocket,
  and generated OpenAPI types.

## Data Flow

1. Kismet telemetry is normalized by the sensor-agent into shared `Event`,
   `AccessPoint`, and `Client` shapes.
2. The sensor connects to `/ws/sensor-gateway` through the Tailscale/mTLS link. The
   backend verifies the sensor id, signed proxy certificate headers, and stored
   certificate fingerprint before accepting events.
3. The backend persists events and device upserts, evaluates alert rules, and fans
   out operator WebSocket topics such as `events.append`, `aps.upsert`,
   `devices.upsert`, `sensors.update`, `alerts.fire`, `command_result`, and
   `lab.*`.
4. The frontend invalidates TanStack Query caches from those WebSocket topics and
   keeps route state shareable through TanStack Router.

## Backend Boundaries

The backend owns authentication, CSRF, TOTP step-up, CORS, CSP-adjacent response
headers, active-operation gates, audit logging, persistence, report signing, and
operator/sensor fan-out. FastAPI dependencies provide settings, stores, audit
logging, current user resolution, and brokers so endpoint modules remain small.

MongoDB stores sensors, devices, events, alerts, alert rules, audit logs,
acknowledgements, engagements, allow-lists, and report records. Redis is reserved for
pub/sub and task queue wiring as the deployment moves beyond in-process development
brokers.

## Frontend Boundary

The frontend is built as a Vite/React single-page operator console. Its API contract
comes from `packages/shared-types/schemas/openapi.json`, with generated TypeScript in
`apps/frontend/src/services/api/openapi.d.ts`. It also enforces browser-side safety
at navigation and download boundaries with internal-path and same-origin `/api/...`
URL checks.

The production-style frontend image is a non-root nginx container binding port 8080
inside the container and emitting CSP, `nosniff`, referrer, permissions, frame, COOP,
and CORP headers.

## Active Lab Gates

All active lab functionality is default-deny. A lab start or stop request succeeds
only when the backend validates:

- `CHEEKY_PONY_LAB_MODE=true`
- an `authorized_operator` acknowledgement exists
- the current operator is an admin
- the operator has a recent TOTP verification
- the referenced engagement is active
- the target is present in the engagement allow-list

Every success and refusal writes an audit entry. Sensitive parameter keys are
redacted before audit persistence, and raw tool output is referenced by command id or
artifact hash rather than stored directly in audit records.
