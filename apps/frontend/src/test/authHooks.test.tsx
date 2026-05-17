import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { HttpResponse, http } from "msw";
import {
  AUTH_QUERY_KEY,
  useCurrentUser,
  useLogin,
  useLogout,
  useSetup2FA,
  useVerify2FA,
} from "@/services/auth/hooks";
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
    const { result } = renderHook(() => useLogout(), { wrapper });
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(logoutHit).toBe(true);
    expect(qc.getQueryData(AUTH_QUERY_KEY)).toBeNull();
    expect(qc.getQueryData(["sensors", { limit: 1, offset: 0 }])).toBeUndefined();
    expect(qc.getQueryData(["devices", { limit: 1, offset: 0 }])).toBeUndefined();
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
});
