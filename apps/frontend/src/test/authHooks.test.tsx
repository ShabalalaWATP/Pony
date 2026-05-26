import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { HttpResponse, http } from "msw";
import {
  AUTH_QUERY_KEY,
  isTotpRequired,
  useCurrentUser,
  useLogin,
  useLogout,
  useSetup2FA,
  useVerify2FA,
} from "@/services/auth/hooks";
import { ApiError, apiClient } from "@/services/api/client";

/**
 * Tiny gated query mounted by the invalidation tests. Hits the same
 * `/sensors` endpoint `useSensorsList` does so msw overrides line up,
 * but uses a hand-rolled `useQuery` with retry disabled — that way
 * the test asserts purely on the invalidation behaviour instead of
 * fighting the production hook's built-in retry policy.
 */
function useGatedSensors() {
  return useQuery<unknown, ApiError>({
    queryKey: ["sensors", { limit: 100, offset: 0 }],
    queryFn: () => apiClient.get("/sensors?limit=100&offset=0"),
    retry: false,
  });
}
import { fixtures } from "./msw/handlers";
import { server } from "./msw/server";

function wrapperFactory(): {
  wrapper: (p: { children: ReactNode }) => JSX.Element;
  qc: QueryClient;
} {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper, qc };
}

describe("useCurrentUser", () => {
  it("resolves to LoginResponse when refresh succeeds", async () => {
    const { wrapper } = wrapperFactory();
    const { result } = renderHook(() => useCurrentUser(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.user.email).toBe(fixtures.user.email);
  });

  it("resolves to null when refresh returns 401", async () => {
    server.use(
      http.post("/api/v1/auth/refresh", () =>
        HttpResponse.json({ detail: "Not auth" }, { status: 401 }),
      ),
    );
    const { wrapper } = wrapperFactory();
    const { result } = renderHook(() => useCurrentUser(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("surfaces non-401 errors", async () => {
    server.use(
      http.post("/api/v1/auth/refresh", () =>
        HttpResponse.json({ detail: "Boom" }, { status: 500 }),
      ),
    );
    const { wrapper } = wrapperFactory();
    const { result } = renderHook(() => useCurrentUser(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.status).toBe(500);
  });
});

describe("useLogin", () => {
  it("populates the currentUser cache on success", async () => {
    const { wrapper, qc } = wrapperFactory();
    const { result } = renderHook(() => useLogin(), { wrapper });
    result.current.mutate({ email: fixtures.user.email, password: "right" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const cached = qc.getQueryData<{ user: { email: string } }>(AUTH_QUERY_KEY);
    expect(cached?.user.email).toBe(fixtures.user.email);
  });

  it("surfaces 401 from the backend", async () => {
    const { wrapper } = wrapperFactory();
    const { result } = renderHook(() => useLogin(), { wrapper });
    result.current.mutate({ email: fixtures.user.email, password: "wrong" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.status).toBe(401);
  });
});

describe("useLogout", () => {
  it("POSTs /auth/logout and clears the currentUser cache + dependent server caches", async () => {
    let logoutHit = false;
    server.use(
      http.post("/api/v1/auth/logout", () => {
        logoutHit = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { wrapper, qc } = wrapperFactory();
    qc.setQueryData(AUTH_QUERY_KEY, { csrf_token: "x", user: fixtures.user });
    qc.setQueryData(["sensors", { limit: 1, offset: 0 }], { items: [{ id: "s1" }] });
    qc.setQueryData(["devices", { limit: 1, offset: 0 }], { items: [{ mac: "x" }] });
    qc.setQueryData(["audit", { limit: 200, offset: 0 }], { items: [fixtures.auditEntry] });
    const { result } = renderHook(() => useLogout(), { wrapper });
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(logoutHit).toBe(true);
    expect(qc.getQueryData(AUTH_QUERY_KEY)).toBeNull();
    expect(qc.getQueryData(["sensors", { limit: 1, offset: 0 }])).toBeUndefined();
    expect(qc.getQueryData(["devices", { limit: 1, offset: 0 }])).toBeUndefined();
    expect(qc.getQueryData(["audit", { limit: 200, offset: 0 }])).toBeUndefined();
  });

  it("still clears local state when the backend returns 401 (session already gone)", async () => {
    server.use(
      http.post("/api/v1/auth/logout", () =>
        HttpResponse.json({ detail: "Not auth" }, { status: 401 }),
      ),
    );
    const { wrapper, qc } = wrapperFactory();
    qc.setQueryData(AUTH_QUERY_KEY, { csrf_token: "x", user: fixtures.user });
    const { result } = renderHook(() => useLogout(), { wrapper });
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryData(AUTH_QUERY_KEY)).toBeNull();
  });

  it("surfaces non-401 errors but still flushes local state", async () => {
    server.use(
      http.post("/api/v1/auth/logout", () =>
        HttpResponse.json({ detail: "Boom" }, { status: 500 }),
      ),
    );
    const { wrapper, qc } = wrapperFactory();
    qc.setQueryData(AUTH_QUERY_KEY, { csrf_token: "x", user: fixtures.user });
    const { result } = renderHook(() => useLogout(), { wrapper });
    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.status).toBe(500);
    // onSettled still ran.
    expect(qc.getQueryData(AUTH_QUERY_KEY)).toBeNull();
  });
});

describe("useSetup2FA / useVerify2FA", () => {
  it("setup returns provisioning uri + secret", async () => {
    const { wrapper } = wrapperFactory();
    const { result } = renderHook(() => useSetup2FA(), { wrapper });
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.secret).toBeTruthy();
    expect(result.current.data?.provisioning_uri).toContain("otpauth://");
  });

  it("verify with bad code surfaces 400", async () => {
    const { wrapper } = wrapperFactory();
    const { result } = renderHook(() => useVerify2FA(), { wrapper });
    result.current.mutate("000000");
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.status).toBe(400);
  });

  it("verify with good code flips totp_enabled in cache", async () => {
    const { wrapper, qc } = wrapperFactory();
    qc.setQueryData(AUTH_QUERY_KEY, {
      csrf_token: "x",
      user: { ...fixtures.user, totp_enabled: false },
    });
    const { result } = renderHook(() => useVerify2FA(), { wrapper });
    result.current.mutate("123456");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const cached = qc.getQueryData<{ user: { totp_enabled: boolean } }>(AUTH_QUERY_KEY);
    expect(cached?.user.totp_enabled).toBe(true);
  });

  it("verify success refetches sensors when it was sitting on a 403", async () => {
    const { wrapper } = wrapperFactory();
    let sensorsHits = 0;
    server.use(
      http.get("/api/v1/sensors", () => {
        sensorsHits += 1;
        // Stay-on-403 for the first call (gate closed). After verify
        // we want the refetch to land on a 200 so we can see the
        // recovery — the test asserts the refetch *happened*.
        if (sensorsHits === 1) {
          return HttpResponse.json({ detail: "Admin + 2FA required" }, { status: 403 });
        }
        return HttpResponse.json({ items: [], total: 0, limit: 100, offset: 0 });
      }),
    );

    // Mount `useSensorsList` so the query has an active observer —
    // this is the production state (operator is sitting on /sensors).
    // Without an observer, `invalidateQueries` marks the query stale
    // but does not refetch.
    const { result: sensors } = renderHook(() => useGatedSensors(), { wrapper });
    await waitFor(() => expect(sensors.current.isError).toBe(true));
    expect(sensors.current.error?.status).toBe(403);
    expect(sensorsHits).toBe(1);

    // Run verify. The onSuccess callback fires invalidateQueries with
    // the 403-predicate, which (because the sensors observer is live)
    // immediately triggers a refetch.
    const { result: verify } = renderHook(() => useVerify2FA(), { wrapper });
    verify.current.mutate("123456");
    await waitFor(() => expect(verify.current.isSuccess).toBe(true));

    // The post-invalidate refetch lands on the 200 path → sensors
    // hook now reports success without the operator navigating.
    await waitFor(() => expect(sensors.current.isSuccess).toBe(true));
    expect(sensorsHits).toBe(2);
  });

  it("verify success does NOT refetch non-403 errored queries", async () => {
    const { wrapper } = wrapperFactory();
    let sensorsHits = 0;
    server.use(
      http.get("/api/v1/sensors", () => {
        sensorsHits += 1;
        return HttpResponse.json({ detail: "Boom" }, { status: 500 });
      }),
    );
    const { result: sensors } = renderHook(() => useGatedSensors(), { wrapper });
    await waitFor(() => expect(sensors.current.isError).toBe(true));
    expect(sensors.current.error?.status).toBe(500);
    const hitsBeforeVerify = sensorsHits;

    const { result: verify } = renderHook(() => useVerify2FA(), { wrapper });
    verify.current.mutate("123456");
    await waitFor(() => expect(verify.current.isSuccess).toBe(true));

    // Give any unwanted refetch a chance to fire, then assert it
    // didn't — a 500 isn't a gate refusal, and a flapping backend
    // shouldn't be hammered by every verify.
    await new Promise((r) => setTimeout(r, 50));
    expect(sensorsHits).toBe(hitsBeforeVerify);
  });
});

describe("isTotpRequired", () => {
  it("returns true for a 403 ApiError with detail=totp_required", () => {
    const err = new ApiError(403, "totp_required", { detail: "totp_required" });
    expect(isTotpRequired(err)).toBe(true);
  });

  it("returns false for 403 with a different detail string", () => {
    const err = new ApiError(403, "Admin + 2FA required", {
      detail: "Admin + 2FA required",
    });
    expect(isTotpRequired(err)).toBe(false);
  });

  it("returns false for a non-403 status, even if body says totp_required", () => {
    const err = new ApiError(401, "totp_required", { detail: "totp_required" });
    expect(isTotpRequired(err)).toBe(false);
  });

  it("returns false for non-ApiError inputs", () => {
    expect(isTotpRequired(new Error("nope"))).toBe(false);
    expect(isTotpRequired(null)).toBe(false);
    expect(isTotpRequired({ status: 403, body: { detail: "totp_required" } })).toBe(false);
  });

  it("returns false when the body has no parsable detail", () => {
    expect(isTotpRequired(new ApiError(403, "x", null))).toBe(false);
    expect(isTotpRequired(new ApiError(403, "x", "raw"))).toBe(false);
    expect(isTotpRequired(new ApiError(403, "x", { other: "field" }))).toBe(false);
  });
});
