import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  isLabRefusal,
  useAcknowledgeOperator,
  useActiveEngagement,
  useActiveLabCommands,
  useAddAllowListTarget,
  useAllowList,
  useEndEngagement,
  useEngagementsList,
  useLabStatus,
  useRemoveAllowListTarget,
  useResumeEngagement,
  useStartLabModule,
  useStopLabModule,
} from "@/services/api/labQueries";
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

describe("lab + engagement query hooks", () => {
  it("useActiveEngagement returns the engagement on 200", async () => {
    server.use(
      http.get("/api/v1/engagements/active", () => HttpResponse.json(fixtures.engagement)),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useActiveEngagement(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe(fixtures.engagement.id);
  });

  it("useActiveEngagement surfaces 404 without retrying", async () => {
    let calls = 0;
    server.use(
      http.get("/api/v1/engagements/active", () => {
        calls += 1;
        return HttpResponse.json({ detail: "none" }, { status: 404 });
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useActiveEngagement(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.status).toBe(404);
    expect(calls).toBe(1);
  });

  it("useAddAllowListTarget POSTs kind+value to the engagement allow-list", async () => {
    let body: unknown = null;
    let path = "";
    server.use(
      http.post("/api/v1/engagements/:id/allow-list", async ({ params, request }) => {
        path = typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useAddAllowListTarget(), { wrapper });
    result.current.mutate({
      engagementId: "eng-9",
      payload: { kind: "bssid", value: "aa:bb:cc:dd:ee:42" },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(path).toBe("eng-9");
    expect(body).toEqual({ kind: "bssid", value: "aa:bb:cc:dd:ee:42" });
  });

  it("useEndEngagement POSTs to /engagements/{id}/end", async () => {
    let path = "";
    server.use(
      http.post("/api/v1/engagements/:id/end", ({ params }) => {
        path = typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useEndEngagement(), { wrapper });
    result.current.mutate("eng-X");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(path).toBe("eng-X");
  });

  it("useActiveLabCommands returns the current page", async () => {
    server.use(
      http.get("/api/v1/lab/active", () =>
        HttpResponse.json({
          items: [fixtures.labActiveCommand],
          total: 1,
          limit: 100,
          offset: 0,
        }),
      ),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useActiveLabCommands(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items[0]?.command_id).toBe(fixtures.labActiveCommand.command_id);
  });

  it("useStartLabModule POSTs to /lab/{module}/start with the body", async () => {
    let module = "";
    let body: unknown = null;
    server.use(
      http.post("/api/v1/lab/:module/start", async ({ params, request }) => {
        module = typeof params.module === "string" ? params.module : (params.module?.[0] ?? "");
        body = await request.json();
        return HttpResponse.json(
          { command_id: "cmd-x", started_at: "2026-05-17T10:00:00Z" },
          { status: 202 },
        );
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useStartLabModule(), { wrapper });
    result.current.mutate({
      module: "rogue-ap",
      body: {
        sensor_id: "sensor-1",
        engagement_id: "eng-1",
        target: { kind: "bssid", value: "aa:bb:cc:dd:ee:01" },
        parameters: {},
      },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(module).toBe("rogue-ap");
    expect(body).toMatchObject({
      sensor_id: "sensor-1",
      engagement_id: "eng-1",
      target: { kind: "bssid", value: "aa:bb:cc:dd:ee:01" },
    });
    expect(result.current.data?.command_id).toBe("cmd-x");
  });

  it("useStartLabModule surfaces a 403 refusal with reason/detail in error.body", async () => {
    server.use(
      http.post("/api/v1/lab/:module/start", () =>
        HttpResponse.json(
          {
            reason: "lab_mode_disabled",
            detail: "LAB_MODE must be enabled before active actions.",
          },
          { status: 403 },
        ),
      ),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useStartLabModule(), { wrapper });
    result.current.mutate({
      module: "deauth",
      body: {
        sensor_id: "s-1",
        engagement_id: "e-1",
        target: { kind: "bssid", value: "aa:bb:cc:dd:ee:01" },
        parameters: {},
      },
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.status).toBe(403);
    expect(isLabRefusal(result.current.error?.body)).toBe(true);
    if (isLabRefusal(result.current.error?.body)) {
      expect(result.current.error.body.reason).toBe("lab_mode_disabled");
    }
  });

  it("useStopLabModule POSTs to /lab/{module}/stop/{command_id}", async () => {
    let module = "";
    let cmd = "";
    server.use(
      http.post("/api/v1/lab/:module/stop/:commandId", ({ params }) => {
        module = typeof params.module === "string" ? params.module : (params.module?.[0] ?? "");
        cmd =
          typeof params.commandId === "string" ? params.commandId : (params.commandId?.[0] ?? "");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useStopLabModule(), { wrapper });
    result.current.mutate({ module: "mitm", commandId: "cmd-abc" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(module).toBe("mitm");
    expect(cmd).toBe("cmd-abc");
  });

  it("isLabRefusal narrows safely on unknown bodies", () => {
    expect(isLabRefusal(null)).toBe(false);
    expect(isLabRefusal({ reason: 1, detail: "x" })).toBe(false);
    expect(isLabRefusal({ reason: "x" })).toBe(false);
    expect(isLabRefusal({ reason: "x", detail: "y" })).toBe(true);
  });

  it("useLabStatus returns the four gate flags", async () => {
    server.use(
      http.get("/api/v1/lab/status", () =>
        HttpResponse.json({
          lab_mode: true,
          acknowledgement_on_file: false,
          is_admin_2fa: true,
        }),
      ),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useLabStatus(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      lab_mode: true,
      acknowledgement_on_file: false,
      is_admin_2fa: true,
    });
  });

  it("useEngagementsList returns the paginated engagements page", async () => {
    let url = "";
    server.use(
      http.get("/api/v1/engagements", ({ request }) => {
        url = request.url;
        return HttpResponse.json({
          items: [fixtures.engagement],
          total: 1,
          limit: 50,
          offset: 0,
        });
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useEngagementsList({ limit: 50 }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items[0]?.id).toBe(fixtures.engagement.id);
    expect(url).toContain("limit=50");
  });

  it("useResumeEngagement POSTs to /engagements/{id}/resume and returns the engagement", async () => {
    let path = "";
    server.use(
      http.post("/api/v1/engagements/:id/resume", ({ params }) => {
        path = typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");
        return HttpResponse.json({ ...fixtures.engagement, ended_at: null });
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useResumeEngagement(), { wrapper });
    result.current.mutate("eng-RZ");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(path).toBe("eng-RZ");
  });

  it("useAllowList is disabled until an engagement id is supplied", () => {
    const { wrapper } = wrap();
    const { result } = renderHook(() => useAllowList(null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("useAllowList returns the engagement's allow-list page", async () => {
    let url = "";
    server.use(
      http.get("/api/v1/engagements/:id/allow-list", ({ request }) => {
        url = request.url;
        return HttpResponse.json({
          items: [
            { kind: "bssid", value: "aa:bb:cc:dd:ee:01" },
            { kind: "ssid", value: "Office-WiFi" },
          ],
          total: 2,
          limit: 200,
          offset: 0,
        });
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useAllowList("eng-3"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items).toHaveLength(2);
    expect(url).toContain("/engagements/eng-3/allow-list");
  });

  it("useAddAllowListTarget POSTs kind+value", async () => {
    let body: unknown = null;
    server.use(
      http.post("/api/v1/engagements/:id/allow-list", async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useAddAllowListTarget(), { wrapper });
    result.current.mutate({
      engagementId: "eng-A",
      payload: { kind: "bssid", value: "aa:bb:cc:dd:ee:42" },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual({ kind: "bssid", value: "aa:bb:cc:dd:ee:42" });
  });

  it("useRemoveAllowListTarget DELETEs kind+value in the body", async () => {
    let path = "";
    let body: unknown = null;
    server.use(
      http.delete("/api/v1/engagements/:id/allow-list", async ({ params, request }) => {
        path = typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useRemoveAllowListTarget(), { wrapper });
    result.current.mutate({
      engagementId: "eng-9",
      payload: { kind: "ssid", value: "Office-WiFi" },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(path).toBe("eng-9");
    expect(body).toEqual({ kind: "ssid", value: "Office-WiFi" });
  });

  it("useAcknowledgeOperator POSTs the statement and returns the record", async () => {
    let body: unknown = null;
    server.use(
      http.post("/api/v1/system/acknowledgements", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          kind: "authorized_operator",
          accepted_by: "operator@cheeky.local",
          accepted_at: "2026-05-17T10:00:00Z",
          statement_hash: "sha256:abc",
        });
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useAcknowledgeOperator(), { wrapper });
    result.current.mutate({ statement: "I am an authorised operator…" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual({ statement: "I am an authorised operator…" });
    expect(result.current.data?.kind).toBe("authorized_operator");
  });

  it("useAcknowledgeOperator surfaces 403 (admin/2FA missing)", async () => {
    server.use(
      http.post("/api/v1/system/acknowledgements", () =>
        HttpResponse.json({ detail: "Admin role with recent TOTP required" }, { status: 403 }),
      ),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useAcknowledgeOperator(), { wrapper });
    result.current.mutate({ statement: "..." });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.status).toBe(403);
  });
});
