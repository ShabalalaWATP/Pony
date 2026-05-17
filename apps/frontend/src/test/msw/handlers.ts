import { HttpResponse, http } from "msw";
import type { components } from "@/services/api/openapi";

type LoginResponse = components["schemas"]["LoginResponse"];
type LoginRequest = components["schemas"]["LoginRequest"];
type UserPublic = components["schemas"]["UserPublic"];
type AccessPoint = components["schemas"]["AccessPoint"];
type Client = components["schemas"]["Client"];
type Event = components["schemas"]["Event"];

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
    flags: [],
  } satisfies AccessPoint,
  device: {
    mac: "38:c9:86:1c:33:a2",
    vendor_oui: "Samsung",
    associated_bssid: "a4:c3:f0:1d:88:0a",
    probes: [],
    signal_history: [],
  } satisfies Client,
  event: {
    id: "00000000-0000-0000-0000-000000000099",
    sensor_id: "sensor-1",
    kind: "access_point_seen",
    payload: { ssid: "TestNet", bssid: "a4:c3:f0:1d:88:0a" },
    occurred_at: "2026-05-17T10:00:00Z",
  } satisfies Event,
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
  http.get("/api/v1/access_points/:bssid/clients", () =>
    HttpResponse.json({ items: [fixtures.device], total: 1, limit: 100, offset: 0 }),
  ),
  http.get("/api/v1/devices", () =>
    HttpResponse.json({ items: [fixtures.device], total: 1, limit: 100, offset: 0 }),
  ),
  http.get("/api/v1/events", () =>
    HttpResponse.json({ items: [fixtures.event], total: 1, limit: 50, offset: 0 }),
  ),
  // Sensors is gated on admin + 2FA, so the default returns 403 — the
  // KPI tile handles this gracefully. Tests that need a successful
  // response override with `server.use(...)`.
  http.get("/api/v1/sensors", () =>
    HttpResponse.json({ detail: "Admin role with recent TOTP required" }, { status: 403 }),
  ),
];

export const unauthenticatedHandlers = [
  http.post("/api/v1/auth/refresh", () =>
    HttpResponse.json({ detail: "Not authenticated" }, { status: 401 }),
  ),
];
