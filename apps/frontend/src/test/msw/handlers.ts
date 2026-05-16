import { HttpResponse, http } from "msw";
import type { components } from "@/services/api/openapi";

type LoginResponse = components["schemas"]["LoginResponse"];
type LoginRequest = components["schemas"]["LoginRequest"];
type UserPublic = components["schemas"]["UserPublic"];

export const fixtures = {
  user: {
    id: "00000000-0000-0000-0000-000000000001",
    email: "operator@cheeky.local",
    roles: ["operator"],
    totp_enabled: false,
  } satisfies UserPublic,
  csrf: "test-csrf-token",
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
];

export const unauthenticatedHandlers = [
  http.post("/api/v1/auth/refresh", () =>
    HttpResponse.json({ detail: "Not authenticated" }, { status: 401 }),
  ),
];
