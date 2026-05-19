# Architecture

Cheeky Pony is split into three deployable surfaces:

- `sensor-agent`: a Raspberry Pi service that talks to local WiFi tooling, streams
  normalized passive events, exposes local health/capability endpoints, and receives
  backend commands over the authenticated sensor WebSocket.
- `backend`: FastAPI, MongoDB, Redis, in-process development brokers, and worker
  boundaries on the operator PC.
- `frontend`: a React operator console that consumes REST, the operator WebSocket,
  and generated OpenAPI types.

## System topology

```mermaid
flowchart LR
  subgraph PI["Raspberry Pi (sensor)"]
    direction TB
    K["Kismet<br/>(passive capture)"]
    B["bettercap / aircrack-ng /<br/>hostapd-mana"]
    SA["sensor-agent<br/>(asyncio + mTLS WS)"]
    HL["local /health<br/>:9090"]
    K -->|REST + WS| SA
    B -.->|future capability| SA
    SA --- HL
  end

  subgraph WS["WireGuard tunnel"]
    TS["Tailscale tailnet"]
  end

  subgraph PC["Operator PC"]
    direction TB
    subgraph BE["FastAPI backend"]
      API["REST API<br/>/api/v1/*"]
      SGW["sensor gateway WS<br/>/ws/sensor-gateway"]
      OWS["operator WS<br/>/ws/operator"]
      DSR["demo stream relay"]
      GATE["lab gate stack"]
      AUDIT["audit logger"]
    end
    MONGO[(MongoDB 7<br/>events, devices, audit,<br/>users, engagements,<br/>demo stream queue)]
    REDIS[(Redis<br/>pub/sub + queue)]
    FE["React frontend<br/>Vite + TS strict"]
    DEMO["seed_demo CLI<br/>--stream"]

    API --- MONGO
    API --- REDIS
    SGW --- MONGO
    DSR --- MONGO
    DSR --> OWS
    OWS --- REDIS
    GATE -.->|guards| API
    AUDIT --- MONGO
    DEMO -.->|dev-only synthetic topics| MONGO
    FE -->|cookie auth + CSRF| API
    FE -->|JWT WS| OWS
  end

  SA <-->|mTLS WS<br/>events / commands| TS
  TS <-->|mTLS WS| SGW
```

The Pi ↔ PC link rides Tailscale's WireGuard tunnel; mTLS termination happens at
the FastAPI sensor-gateway. Sensor identity is bound to the signed client-cert
fingerprint stored on the backend, not just the WebSocket handshake.

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
4. In local development, `seed_demo --stream` writes transient synthetic topic
   records into MongoDB. The backend relay polls that queue and publishes through
   the same operator topic helpers used by real sensor events.
5. The frontend invalidates TanStack Query caches from those WebSocket topics and
   keeps route state shareable through TanStack Router.

```mermaid
sequenceDiagram
  autonumber
  participant K as Kismet
  participant SA as sensor-agent
  participant SGW as backend<br/>sensor gateway
  participant DB as MongoDB
  participant ALERT as alert<br/>evaluator
  participant OWS as operator WS
  participant FE as frontend

  K->>SA: device.json / event WS
  SA->>SA: normalise → AccessPoint /<br/>Client / Event
  SA->>SGW: mTLS WS frame (Event)
  SGW->>SGW: verify cert fingerprint<br/>+ schema validate
  SGW->>DB: persist event + upsert<br/>AP/Client
  SGW->>ALERT: evaluate rule predicates
  ALERT-->>DB: insert Alert (if matched)
  par fan-out
    SGW-->>OWS: events.append /<br/>aps.upsert / devices.upsert
    ALERT-->>OWS: alerts.fire
  end
  OWS-->>FE: WS topic message
  FE->>FE: invalidate TanStack Query<br/>cache key
  FE->>SGW: REST GET refresh<br/>(if cache stale)
```

## Lab gate stack

Every active-module start request passes through the same default-deny stack.
Any single gate that fails returns `403` with a structured `reason` and writes
an audit entry — accepted starts also audit, so refusal vs. success is
indistinguishable from the audit table's existence alone.

```mermaid
flowchart TD
  REQ["POST /api/v1/lab/{module}/start"] --> AUTH{authenticated<br/>session?}
  AUTH -->|no| D401[401 + audit]
  AUTH -->|yes| ROLE{role = admin?}
  ROLE -->|no| D403A["403 admin_required<br/>+ audit"]
  ROLE -->|yes| TOTP{recent TOTP<br/>within window?}
  TOTP -->|no| D403B["403 missing_2fa<br/>+ audit"]
  TOTP -->|yes| CSRF{CSRF header valid?}
  CSRF -->|no| D403C["403 csrf_failure<br/>+ audit"]
  CSRF -->|yes| LAB{LAB_MODE=true?}
  LAB -->|no| D403D["403 lab_mode_disabled<br/>+ audit"]
  LAB -->|yes| ACK{authorized_operator<br/>acknowledgement<br/>on file?}
  ACK -->|no| D403E["403 no_acknowledgement<br/>+ audit"]
  ACK -->|yes| ENG{engagement active?}
  ENG -->|no| D403F["403 no_active_engagement<br/>+ audit"]
  ENG -->|yes| ALLOW{target in<br/>engagement<br/>allow-list?}
  ALLOW -->|no| D403G["403 target_not_in_allowlist<br/>+ audit"]
  ALLOW -->|yes| QUEUE["queue SensorCommand<br/>over mTLS WS<br/>+ audit accepted"]
  QUEUE --> RESULT["sensor reports outcome<br/>→ audit completion"]

  classDef deny fill:#3a1414,stroke:#a03030,color:#f4d4d4
  class D401,D403A,D403B,D403C,D403D,D403E,D403F,D403G deny
```

The `/api/v1/lab/status` probe exposes the four user-facing gate inputs
(`lab_mode`, `acknowledgement_on_file`, `is_admin_2fa`, plus implicit
engagement context) so the UI can tell the operator *which* gate is missing
before they trigger a refusal.

## Login + TOTP step-up sequence

The cookie-based auth flow uses two factors: argon2id password verification,
then a TOTP challenge that issues a *recent-verification* claim on a short
window. Admin-only routes require that recent-claim, not just the access cookie.

```mermaid
sequenceDiagram
  autonumber
  participant U as operator
  participant FE as frontend
  participant API as backend /auth
  participant DB as MongoDB

  U->>FE: enter email + password
  FE->>API: POST /auth/login
  API->>DB: lookup user, verify argon2id
  alt invalid credentials
    API-->>FE: 401
    FE-->>U: invalid credentials
  else password ok, no TOTP enrolled
    API->>API: issue access + refresh<br/>cookies (httpOnly, SameSite=strict)
    API-->>FE: 200 (no totp_required)
    FE->>FE: store csrf_token<br/>(double-submit)
    FE->>U: dashboard
  else password ok, TOTP required
    API-->>FE: 200 { totp_required: true }
    FE-->>U: prompt for 6-digit code
    U->>FE: enter TOTP
    FE->>API: POST /auth/2fa/verify { code }
    API->>API: pyotp.verify(secret, code)
    alt code invalid
      API-->>FE: 400 invalid_code
      FE-->>U: retry
    else code valid
      API->>API: mark session<br/>recent_totp_at = now
      API-->>FE: 200 (csrf rotated)
      FE->>U: dashboard
    end
  end

  Note over API,DB: Admin endpoints later check that (now - recent_totp_at) is less than CHEEKY_PONY_TOTP_RECENT_MINUTES. Missing or expired claim yields 403 missing_2fa.
```

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
