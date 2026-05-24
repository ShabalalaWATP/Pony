import { HttpResponse, http } from "msw";
import type { components } from "@/services/api/openapi";

type LoginResponse = components["schemas"]["LoginResponse"];
type LoginRequest = components["schemas"]["LoginRequest"];
type UserPublic = components["schemas"]["UserPublic"];
type AccessPoint = components["schemas"]["AccessPoint"];
type Client = components["schemas"]["Client"];
type Event = components["schemas"]["Event"];
type Alert = components["schemas"]["Alert"];
type AlertRule = components["schemas"]["AlertRule"];
type Engagement = components["schemas"]["Engagement"];
type LabActiveCommand = components["schemas"]["LabActiveCommand"];
type LabStatusResponse = components["schemas"]["LabStatusResponse"];
type AllowedTarget = components["schemas"]["AllowedTarget"];
type AuditLog = components["schemas"]["AuditLog"];
type Sensor = components["schemas"]["Sensor"];
type SensorRegisterResponse = components["schemas"]["SensorRegisterResponse"];

export const fixtures = {
  user: {
    id: "00000000-0000-0000-0000-000000000001",
    email: "operator@cheeky.local",
    roles: ["operator"],
    totp_enabled: false,
  } satisfies UserPublic,
  csrf: "test-csrf-token",
  accessPoint: {
    bssid: "a4:c3:f0:1d:88:0a",
    ssid: "TestNet",
    channel: 6,
    band: "2.4",
    encryption: ["wpa2"],
    signal_history: [{ rssi_dbm: -55, seen_at: "2026-05-17T10:00:00Z" }],
    vendor_oui: "Apple",
    anomaly_reasons: [],
    anomaly_score: 0,
    label: "unknown",
    label_confidence: 0,
    flags: [],
    synthetic: false,
  } satisfies AccessPoint,
  device: {
    mac: "38:c9:86:1c:33:a2",
    vendor_oui: "Samsung",
    associated_bssid: "a4:c3:f0:1d:88:0a",
    probes: [],
    signal_history: [],
    label: "unknown",
    label_confidence: 0,
    synthetic: false,
  } satisfies Client,
  event: {
    id: "00000000-0000-0000-0000-000000000099",
    sensor_id: "sensor-1",
    kind: "access_point_seen",
    payload: { ssid: "TestNet", bssid: "a4:c3:f0:1d:88:0a" },
    occurred_at: "2026-05-17T10:00:00Z",
    synthetic: false,
  } satisfies Event,
  alert: {
    id: "a1",
    rule_id: "rule-rogue-ssid",
    severity: "high",
    related_entities: ["aa:bb:cc:dd:ee:01"],
    synthetic: false,
  } satisfies Alert,
  alertRule: {
    id: "rule-1",
    name: "Free WiFi rogue SSID",
    description: "Catch SSIDs matching ^Free.*",
    severity: "high",
    enabled: true,
    predicate: { event_kind: "access_point_seen", match: { ssid: "^Free.*" } },
    created_by: "operator@cheeky.local",
    created_at: "2026-05-17T09:00:00Z",
    synthetic: false,
  } satisfies AlertRule,
  engagement: {
    id: "eng-1",
    name: "Spring assessment 2026",
    scope_rules: [],
    started_at: "2026-05-17T08:00:00Z",
    synthetic: false,
  } satisfies Engagement,
  labActiveCommand: {
    command_id: "lab-cmd-1",
    module: "rogue-ap",
    sensor_id: "sensor-1",
    engagement_id: "eng-1",
    target: { kind: "bssid", value: "aa:bb:cc:dd:ee:01" },
    started_at: "2026-05-17T10:00:00Z",
  } satisfies LabActiveCommand,
  labStatus: {
    lab_mode: false,
    acknowledgement_on_file: false,
    is_admin_2fa: false,
    ready: false,
    checks: [
      {
        id: "lab_mode_env",
        label: "LAB_MODE=true in backend env",
        status: "missing",
        fix_hint: "Set LAB_MODE=true and restart the backend.",
        fix_route: null,
      },
      {
        id: "admin_role",
        label: "Caller has admin role",
        status: "missing",
        fix_hint: "An existing admin must grant your role.",
        fix_route: "/settings/users",
      },
      {
        id: "totp_recent",
        label: "Recent TOTP verification",
        status: "missing",
        fix_hint: "Re-verify in Settings → Account.",
        fix_route: "/settings/account",
      },
      {
        id: "engagement_active",
        label: "An engagement is active",
        status: "missing",
        fix_hint: "Create an engagement in Engagements.",
        fix_route: "/engagements",
      },
      {
        id: "authorized_operator",
        label: "Authorized-operator acknowledgement on file",
        status: "missing",
        fix_hint: "Accept the statement in Settings → System.",
        fix_route: "/settings/system",
      },
      {
        id: "allow_list_nonempty",
        label: "Active engagement has ≥1 target",
        status: "not_applicable",
        fix_hint: "Add targets under the engagement detail.",
        fix_route: null,
      },
    ],
  } satisfies LabStatusResponse,
  allowedTarget: {
    kind: "bssid",
    value: "aa:bb:cc:dd:ee:01",
  } satisfies AllowedTarget,
  sensor: {
    id: "pi-test-01",
    name: "Test Pi",
    tailnet_ip: "100.64.0.10",
    version: "0.1.0",
    capabilities: ["passive_capture", "channel_control"],
    last_seen: "2026-05-17T10:00:00Z",
    revoked: false,
    synthetic: false,
  } satisfies Sensor,
  adminUser: {
    id: "00000000-0000-0000-0000-0000000000ad",
    email: "admin@cheeky.local",
    roles: ["admin"],
    totp_enabled: true,
  } satisfies UserPublic,
  sensorRegister: {
    ca_certificate_pem: "-----BEGIN CERTIFICATE-----\nMIIBCAEXAMPLECA\n-----END CERTIFICATE-----\n",
    client_certificate_pem:
      "-----BEGIN CERTIFICATE-----\nMIIBCAEXAMPLECLIENT\n-----END CERTIFICATE-----\n",
    client_private_key_pem:
      "-----BEGIN PRIVATE KEY-----\nMIIBCAEXAMPLEKEY\n-----END PRIVATE KEY-----\n",
    sensor: {
      id: "pi-test-01",
      name: "Test Pi",
      tailnet_ip: "100.64.0.10",
      version: "0.1.0",
      capabilities: ["passive_capture"],
      last_seen: null,
      revoked: false,
      synthetic: false,
    },
  } satisfies SensorRegisterResponse,
  auditEntry: {
    id: "audit-1",
    actor_id: "operator@cheeky.local",
    action: "lab.deauth.start",
    outcome: "denied:lab_mode_disabled",
    occurred_at: "2026-05-17T10:00:00Z",
    started_at: "2026-05-17T10:00:00Z",
    finished_at: "2026-05-17T10:00:00Z",
    target: { sensor_id: "sensor-1", target: { kind: "bssid", value: "aa:bb:cc:dd:ee:01" } },
    parameters: { module: "deauth" },
  } satisfies AuditLog,
};

export const authHandlers = [
  http.post("/api/v1/auth/login", async ({ request }) => {
    const body = (await request.json()) as LoginRequest;
    if (body.password === "wrong") {
      return HttpResponse.json({ detail: "Invalid credentials" }, { status: 401 });
    }
    return HttpResponse.json<LoginResponse>(
      { csrf_token: fixtures.csrf, user: fixtures.user },
      {
        status: 200,
        headers: {
          "Set-Cookie": `csrf_token=${fixtures.csrf}; Path=/; SameSite=Strict`,
        },
      },
    );
  }),

  http.post("/api/v1/auth/refresh", () => {
    return HttpResponse.json<LoginResponse>(
      { csrf_token: fixtures.csrf, user: fixtures.user },
      { status: 200 },
    );
  }),

  http.post("/api/v1/auth/2fa/setup", () => {
    return HttpResponse.json(
      {
        provisioning_uri:
          "otpauth://totp/Cheeky%20Pony:operator@cheeky.local?secret=JBSWY3DPEHPK3PXP&issuer=Cheeky%20Pony",
        secret: "JBSWY3DPEHPK3PXP",
      },
      { status: 200 },
    );
  }),

  http.post("/api/v1/auth/2fa/verify", async ({ request }) => {
    const body = (await request.json()) as { code: string };
    if (body.code !== "123456") {
      return HttpResponse.json({ detail: "Invalid code" }, { status: 400 });
    }
    return HttpResponse.json<UserPublic>({ ...fixtures.user, totp_enabled: true }, { status: 200 });
  }),

  http.post("/api/v1/auth/logout", () => new HttpResponse(null, { status: 204 })),

  // Data endpoints — default empty pages so list pages don't 5xx in tests
  // that don't bother to override them.
  http.get("/api/v1/access_points", () =>
    HttpResponse.json({ items: [fixtures.accessPoint], total: 1, limit: 100, offset: 0 }),
  ),
  // Evil-twin candidates default to empty so tests that don't care
  // about this surface don't need an explicit handler. Cases that do
  // care override with `server.use(...)`.
  http.get("/api/v1/access_points/evil-twin-candidates", () =>
    HttpResponse.json({ items: [], total: 0, limit: 100, offset: 0 }),
  ),
  http.get("/api/v1/access_points/:bssid", ({ params }) => {
    if (
      typeof params.bssid === "string" &&
      params.bssid.toLowerCase() === fixtures.accessPoint.bssid
    ) {
      return HttpResponse.json(fixtures.accessPoint);
    }
    return HttpResponse.json({ detail: "access point not found" }, { status: 404 });
  }),
  http.get("/api/v1/access_points/:bssid/clients", () =>
    HttpResponse.json({ items: [fixtures.device], total: 1, limit: 100, offset: 0 }),
  ),
  http.get("/api/v1/devices", () =>
    HttpResponse.json({ items: [fixtures.device], total: 1, limit: 100, offset: 0 }),
  ),
  http.get("/api/v1/devices/:mac", ({ params }) => {
    if (typeof params.mac === "string" && params.mac.toLowerCase() === fixtures.device.mac) {
      return HttpResponse.json(fixtures.device);
    }
    return HttpResponse.json({ detail: "device not found" }, { status: 404 });
  }),
  http.get("/api/v1/events", () =>
    HttpResponse.json({ items: [fixtures.event], total: 1, limit: 50, offset: 0 }),
  ),
  // Audit log — backend gates on auth; default returns a single
  // entry so the table tests have something to render. Tests that
  // need a 403 surface override with `server.use(...)`.
  http.get("/api/v1/audit", () =>
    HttpResponse.json({ items: [fixtures.auditEntry], total: 1, limit: 200, offset: 0 }),
  ),
  // Sensors is gated on admin + 2FA, so the default returns 403 — the
  // KPI tile handles this gracefully. Tests that need a successful
  // response override with `server.use(...)`.
  http.get("/api/v1/sensors", () =>
    HttpResponse.json({ detail: "Admin role with recent TOTP required" }, { status: 403 }),
  ),
  // Register / revoke are admin+2FA-gated; defaults return success so
  // happy-path drawer tests don't need an override. 403 cases override
  // with `server.use(...)`.
  http.post("/api/v1/sensors", () => HttpResponse.json(fixtures.sensorRegister, { status: 200 })),
  http.post("/api/v1/sensors/:sensorId/revoke", () => new HttpResponse(null, { status: 204 })),

  // Alerts contract surfaces — defaults are populated so OverviewRecentAlerts
  // shows a row; tests override per-case as needed.
  http.get("/api/v1/alerts", () =>
    HttpResponse.json({ items: [fixtures.alert], total: 1, limit: 100, offset: 0 }),
  ),
  http.post("/api/v1/alerts/:alertId/ack", () => new HttpResponse(null, { status: 204 })),
  // Rule management is admin-gated server-side; default 403 mirrors that.
  http.get("/api/v1/alerts/rules", () =>
    HttpResponse.json({ detail: "Admin role with recent TOTP required" }, { status: 403 }),
  ),
  http.post("/api/v1/alerts/rules", () => HttpResponse.json(fixtures.alertRule, { status: 200 })),
  http.patch("/api/v1/alerts/rules/:ruleId", () =>
    HttpResponse.json(fixtures.alertRule, { status: 200 }),
  ),
  http.delete("/api/v1/alerts/rules/:ruleId", () => new HttpResponse(null, { status: 204 })),

  // Sensor lifecycle commands — defaults return 202 with a generated id.
  http.post("/api/v1/sensors/:sensorId/commands/restart", () =>
    HttpResponse.json({ command_id: "cmd-restart-test" }, { status: 202 }),
  ),
  http.post("/api/v1/sensors/:sensorId/commands/update", () =>
    HttpResponse.json({ command_id: "cmd-update-test" }, { status: 202 }),
  ),
  http.post("/api/v1/sensors/:sensorId/commands/set-channel", () =>
    HttpResponse.json({ command_id: "cmd-channel-test" }, { status: 202 }),
  ),

  // Lab / engagements — defaults: no active engagement (404) so the
  // lab UI shows the gate banner; tests with a real engagement
  // override per-case.
  http.get("/api/v1/engagements", () =>
    HttpResponse.json({ items: [fixtures.engagement], total: 1, limit: 100, offset: 0 }),
  ),
  // Engagement detail — happy path for the fixture id, 404 otherwise.
  http.get("/api/v1/engagements/:id", ({ params }) => {
    if (params.id === fixtures.engagement.id) {
      return HttpResponse.json(fixtures.engagement);
    }
    return HttpResponse.json({ detail: "engagement not found" }, { status: 404 });
  }),
  // Users list is admin+2FA gated — default 403 mirrors backend. Tests
  // that need a populated list override with `server.use(...)`.
  http.get("/api/v1/users", () =>
    HttpResponse.json({ detail: "Admin role with recent TOTP required" }, { status: 403 }),
  ),
  // PATCH default returns the fixture user updated with the body's
  // requested roles so the happy-path drawer test can land.
  http.patch("/api/v1/users/:userId", async ({ request, params }) => {
    const body = (await request.json()) as { roles?: string[] | null; reset_totp?: boolean };
    const updated: UserPublic = {
      ...fixtures.user,
      id: typeof params.userId === "string" ? params.userId : fixtures.user.id,
      roles: body.roles ?? fixtures.user.roles,
      totp_enabled: body.reset_totp ? false : fixtures.user.totp_enabled,
    };
    return HttpResponse.json(updated);
  }),
  // POST /engagements default returns the fixture so the create-drawer
  // flow can land an Engagement; tests that need a 403 / validation
  // error override per-case via server.use(...).
  http.post("/api/v1/engagements", () => HttpResponse.json(fixtures.engagement)),
  http.get("/api/v1/engagements/active", () =>
    HttpResponse.json({ detail: "no active engagement" }, { status: 404 }),
  ),
  http.get("/api/v1/engagements/:id/allow-list", () =>
    HttpResponse.json({ items: [], total: 0, limit: 200, offset: 0 }),
  ),
  http.post("/api/v1/engagements/:id/allow-list", () => new HttpResponse(null, { status: 204 })),
  http.delete("/api/v1/engagements/:id/allow-list", () => new HttpResponse(null, { status: 204 })),
  http.post("/api/v1/engagements/:id/end", () => new HttpResponse(null, { status: 204 })),
  http.post("/api/v1/engagements/:id/resume", () => HttpResponse.json(fixtures.engagement)),
  http.get("/api/v1/lab/status", () => HttpResponse.json(fixtures.labStatus)),
  // One-time authorized-operator acknowledgement. Default returns the
  // SystemAcknowledgement shape; SystemView tests that need a 403 or
  // a duplicate-record case override with server.use(...).
  http.post("/api/v1/system/acknowledgements", () =>
    HttpResponse.json({
      kind: "authorized_operator",
      accepted_by: fixtures.user.id,
      accepted_at: "2026-05-17T10:00:00Z",
      statement_hash: "sha256:test",
    }),
  ),
  http.get("/api/v1/lab/active", () =>
    HttpResponse.json({ items: [], total: 0, limit: 100, offset: 0 }),
  ),
  http.post("/api/v1/lab/:module/start", () =>
    HttpResponse.json(
      { command_id: "lab-cmd-test", started_at: "2026-05-17T10:00:00Z" },
      { status: 202 },
    ),
  ),
  http.post("/api/v1/lab/:module/stop/:commandId", () => new HttpResponse(null, { status: 204 })),

  // Reporting + exports — defaults: POST queues, status starts pending.
  // Tests that need ready/failed states override these per-case.
  http.post("/api/v1/engagements/:id/reports", () =>
    HttpResponse.json({ report_id: "report-test", status: "pending" }, { status: 202 }),
  ),
  http.get("/api/v1/engagements/:id/reports/:reportId", () =>
    HttpResponse.json({ status: "pending" }),
  ),
];

export const unauthenticatedHandlers = [
  http.post("/api/v1/auth/refresh", () =>
    HttpResponse.json({ detail: "Not authenticated" }, { status: 401 }),
  ),
];
