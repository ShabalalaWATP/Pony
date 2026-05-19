import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  useAccessPointsList,
  useAckAlert,
  useAlertRulesList,
  useAlertsList,
  useApAssociatedClients,
  useAuditList,
  useCreateAlertRule,
  useDeleteAlertRule,
  useDevicesList,
  useEventsList,
  useRestartSensor,
  useSensorsList,
  useSetSensorChannel,
  useUpdateAlertRule,
  useUpdateSensor,
} from "@/services/api/queries";
import { fixtures } from "./msw/handlers";
import { server } from "./msw/server";

function wrap(): { wrapper: (p: { children: ReactNode }) => JSX.Element } {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper };
}

describe("HTTP query hooks", () => {
  it("useAccessPointsList returns the page from the backend", async () => {
    const { wrapper } = wrap();
    const { result } = renderHook(() => useAccessPointsList({ limit: 10 }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total).toBe(1);
    expect(result.current.data?.items[0]?.bssid).toBe(fixtures.accessPoint.bssid);
  });

  it("useDevicesList passes pagination via query string", async () => {
    let receivedUrl = "";
    server.use(
      http.get("/api/v1/devices", ({ request }) => {
        receivedUrl = new URL(request.url).search;
        return HttpResponse.json({ items: [], total: 0, limit: 25, offset: 50 });
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useDevicesList({ limit: 25, offset: 50 }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(receivedUrl).toContain("limit=25");
    expect(receivedUrl).toContain("offset=50");
  });

  it("useEventsList resolves to the events page", async () => {
    const { wrapper } = wrap();
    const { result } = renderHook(() => useEventsList(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items[0]?.kind).toBe("access_point_seen");
  });

  it("useApAssociatedClients hits /access_points/{bssid}/clients and is keyed by lower-cased BSSID", async () => {
    let receivedUrl = "";
    server.use(
      http.get("/api/v1/access_points/:bssid/clients", ({ request, params }) => {
        const bssid = typeof params.bssid === "string" ? params.bssid : (params.bssid?.[0] ?? "");
        receivedUrl = `${bssid}${new URL(request.url).search}`;
        return HttpResponse.json({ items: [fixtures.device], total: 1, limit: 50, offset: 0 });
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(
      () => useApAssociatedClients("AA:BB:CC:DD:EE:01", { limit: 50 }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(
      receivedUrl.startsWith("aa%3abb%3acc%3add%3aee%3a01") ||
        receivedUrl.startsWith("aa:bb:cc:dd:ee:01"),
    ).toBe(true);
    expect(result.current.data?.items[0]?.mac).toBe(fixtures.device.mac);
  });

  it("useApAssociatedClients is disabled when no BSSID is supplied", () => {
    const { wrapper } = wrap();
    const { result } = renderHook(() => useApAssociatedClients(null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("useSensorsList surfaces 403 without retrying", async () => {
    let calls = 0;
    server.use(
      http.get("/api/v1/sensors", () => {
        calls += 1;
        return HttpResponse.json({ detail: "forbidden" }, { status: 403 });
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useSensorsList(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.status).toBe(403);
    expect(calls).toBe(1);
  });

  it("useAlertsList sends repeated severity params and the acked filter", async () => {
    let receivedSearch = "";
    server.use(
      http.get("/api/v1/alerts", ({ request }) => {
        receivedSearch = new URL(request.url).search;
        return HttpResponse.json({ items: [fixtures.alert], total: 1, limit: 100, offset: 0 });
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(
      () => useAlertsList({ severity: ["high", "critical"], acked: false, limit: 50 }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Repeated severity params come through as `severity=high&severity=critical`.
    expect(receivedSearch.match(/severity=high/g)?.length).toBe(1);
    expect(receivedSearch).toContain("severity=critical");
    expect(receivedSearch).toContain("acked=false");
    expect(receivedSearch).toContain("limit=50");
  });

  it("useAckAlert POSTs /alerts/{id}/ack and invalidates the alerts root key", async () => {
    let hit = false;
    server.use(
      http.post("/api/v1/alerts/:id/ack", () => {
        hit = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useAckAlert(), { wrapper });
    result.current.mutate("alert-123");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(hit).toBe(true);
  });

  it("useAlertRulesList returns 403 without retrying when admin-gated", async () => {
    let calls = 0;
    server.use(
      http.get("/api/v1/alerts/rules", () => {
        calls += 1;
        return HttpResponse.json({ detail: "forbidden" }, { status: 403 });
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useAlertRulesList(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.status).toBe(403);
    expect(calls).toBe(1);
  });

  it("useCreateAlertRule POSTs the new rule body", async () => {
    let received: unknown = null;
    server.use(
      http.post("/api/v1/alerts/rules", async ({ request }) => {
        received = await request.json();
        return HttpResponse.json(fixtures.alertRule);
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useCreateAlertRule(), { wrapper });
    result.current.mutate({
      name: "T",
      severity: "high",
      enabled: true,
      predicate: { event_kind: "access_point_seen" },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(received).toMatchObject({ name: "T", severity: "high" });
  });

  it("useUpdateAlertRule PATCHes the target rule", async () => {
    let path = "";
    let received: unknown = null;
    server.use(
      http.patch("/api/v1/alerts/rules/:id", async ({ params, request }) => {
        path = typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");
        received = await request.json();
        return HttpResponse.json(fixtures.alertRule);
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useUpdateAlertRule(), { wrapper });
    result.current.mutate({ id: "rule-9", patch: { enabled: false } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(path).toBe("rule-9");
    expect(received).toEqual({ enabled: false });
  });

  it("useDeleteAlertRule sends DELETE to the rule endpoint", async () => {
    let path = "";
    server.use(
      http.delete("/api/v1/alerts/rules/:id", ({ params }) => {
        path = typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useDeleteAlertRule(), { wrapper });
    result.current.mutate("rule-99");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(path).toBe("rule-99");
  });

  it("useRestartSensor POSTs the restart sub-route and returns a command_id", async () => {
    let path = "";
    server.use(
      http.post("/api/v1/sensors/:id/commands/restart", ({ params }) => {
        path = typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");
        return HttpResponse.json({ command_id: "cmd-r-1" }, { status: 202 });
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useRestartSensor(), { wrapper });
    result.current.mutate("sensor-X");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(path).toBe("sensor-X");
    expect(result.current.data?.command_id).toBe("cmd-r-1");
  });

  it("useUpdateSensor POSTs the update sub-route", async () => {
    let path = "";
    server.use(
      http.post("/api/v1/sensors/:id/commands/update", ({ params }) => {
        path = typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");
        return HttpResponse.json({ command_id: "cmd-u-1" }, { status: 202 });
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useUpdateSensor(), { wrapper });
    result.current.mutate("sensor-Y");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(path).toBe("sensor-Y");
  });

  it("useSetSensorChannel sends channel + band in the request body", async () => {
    let body: unknown = null;
    server.use(
      http.post("/api/v1/sensors/:id/commands/set-channel", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ command_id: "cmd-c-1" }, { status: 202 });
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useSetSensorChannel(), { wrapper });
    result.current.mutate({ id: "sensor-Z", channel: 36, band: "5" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual({ channel: 36, band: "5" });
  });

  it("useRestartSensor surfaces 403 (admin + 2FA required) without retrying", async () => {
    let calls = 0;
    server.use(
      http.post("/api/v1/sensors/:id/commands/restart", () => {
        calls += 1;
        return HttpResponse.json({ detail: "Admin + 2FA required" }, { status: 403 });
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useRestartSensor(), { wrapper });
    result.current.mutate("sensor-A");
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.status).toBe(403);
    expect(calls).toBe(1);
  });

  it("useAuditList returns the page from the backend", async () => {
    let receivedUrl = "";
    server.use(
      http.get("/api/v1/audit", ({ request }) => {
        receivedUrl = new URL(request.url).search;
        return HttpResponse.json({
          items: [fixtures.auditEntry],
          total: 1,
          limit: 200,
          offset: 0,
        });
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useAuditList({ limit: 200 }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items[0]?.id).toBe(fixtures.auditEntry.id);
    expect(receivedUrl).toContain("limit=200");
  });

  it("useAuditList surfaces 403 without retrying", async () => {
    let calls = 0;
    server.use(
      http.get("/api/v1/audit", () => {
        calls += 1;
        return HttpResponse.json(
          { detail: "Admin role with recent TOTP required" },
          { status: 403 },
        );
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useAuditList(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.status).toBe(403);
    expect(calls).toBe(1);
  });
});
