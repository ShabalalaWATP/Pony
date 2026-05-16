import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiClient } from "@/services/api/client";
import { server } from "./msw/server";

afterEach(() => {
  document.cookie = "csrf_token=; Max-Age=0; Path=/";
});

describe("apiClient", () => {
  it("returns parsed JSON on 2xx", async () => {
    server.use(
      http.get("/api/v1/devices", () =>
        HttpResponse.json({ items: [], total: 0, limit: 100, offset: 0 }),
      ),
    );
    const data = await apiClient.get<{ items: unknown[]; total: number }>("/devices");
    expect(data.total).toBe(0);
  });

  it("returns undefined on 204", async () => {
    server.use(
      http.post("/api/v1/sensors/abc/revoke", () => new HttpResponse(null, { status: 204 })),
    );
    document.cookie = "csrf_token=tok";
    const result = await apiClient.post<undefined>("/sensors/abc/revoke");
    expect(result).toBeUndefined();
  });

  it("sets x-csrf-token from cookie on POST", async () => {
    let received = "";
    server.use(
      http.post("/api/v1/sensors", ({ request }) => {
        received = request.headers.get("x-csrf-token") ?? "";
        return HttpResponse.json({}, { status: 200 });
      }),
    );
    document.cookie = "csrf_token=my-token";
    await apiClient.post("/sensors", { id: "x", name: "x", tailnet_ip: "1.1.1.1", version: "0" });
    expect(received).toBe("my-token");
  });

  it("does not send csrf header on auth/login", async () => {
    let received: string | null = "default";
    server.use(
      http.post("/api/v1/auth/login", ({ request }) => {
        received = request.headers.get("x-csrf-token");
        return HttpResponse.json({}, { status: 200 });
      }),
    );
    document.cookie = "csrf_token=should-be-ignored";
    await apiClient.post("/auth/login", { email: "a@b.c", password: "x" });
    expect(received).toBeNull();
  });

  it("throws ApiError with a parsed detail message", async () => {
    server.use(
      http.get("/api/v1/devices", () => HttpResponse.json({ detail: "Boom" }, { status: 500 })),
    );
    await expect(apiClient.get("/devices")).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
      message: "Boom",
    });
  });

  it("attempts refresh on 401 and retries the original request", async () => {
    let getCalls = 0;
    let refreshCalls = 0;
    server.use(
      http.get("/api/v1/devices", () => {
        getCalls += 1;
        if (getCalls === 1) {
          return HttpResponse.json({ detail: "Not auth" }, { status: 401 });
        }
        return HttpResponse.json({ items: [], total: 0 });
      }),
      http.post("/api/v1/auth/refresh", () => {
        refreshCalls += 1;
        return HttpResponse.json({ csrf_token: "x", user: {} }, { status: 200 });
      }),
    );
    await apiClient.get<{ items: unknown[] }>("/devices");
    expect(getCalls).toBe(2);
    expect(refreshCalls).toBe(1);
  });

  it("throws 401 ApiError when refresh also fails", async () => {
    server.use(
      http.get("/api/v1/devices", () => HttpResponse.json({ detail: "Not auth" }, { status: 401 })),
      http.post("/api/v1/auth/refresh", () =>
        HttpResponse.json({ detail: "Not auth" }, { status: 401 }),
      ),
    );
    await expect(apiClient.get("/devices")).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
    });
  });

  it("does not attempt refresh for auth endpoints themselves", async () => {
    let refreshCalls = 0;
    server.use(
      http.post("/api/v1/auth/login", () =>
        HttpResponse.json({ detail: "Bad password" }, { status: 401 }),
      ),
      http.post("/api/v1/auth/refresh", () => {
        refreshCalls += 1;
        return HttpResponse.json({}, { status: 200 });
      }),
    );
    await expect(
      apiClient.post("/auth/login", { email: "a@b.c", password: "x" }),
    ).rejects.toThrow();
    expect(refreshCalls).toBe(0);
  });

  it("ApiError carries body and status", async () => {
    server.use(
      http.get("/api/v1/devices", () =>
        HttpResponse.json({ detail: "Forbidden", code: 42 }, { status: 403 }),
      ),
    );
    let captured: ApiError | null = null;
    try {
      await apiClient.get("/devices");
    } catch (err) {
      if (err instanceof ApiError) captured = err;
    }
    expect(captured?.status).toBe(403);
    expect((captured?.body as { code: number }).code).toBe(42);
  });

  it.each(["GET" as const, "POST" as const, "PUT" as const, "PATCH" as const, "DELETE" as const])(
    "supports %s helper",
    async (method) => {
      const calls = vi.fn();
      server.use(
        http.all("/api/v1/probe", ({ request }) => {
          calls(request.method);
          return new HttpResponse(null, { status: 204 });
        }),
      );
      const helper = apiClient[method.toLowerCase() as Lowercase<typeof method>];
      await helper("/probe");
      expect(calls).toHaveBeenCalledWith(method);
    },
  );
});
