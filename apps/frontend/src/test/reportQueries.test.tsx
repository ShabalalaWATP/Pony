import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useCreateReport, useReportStatus } from "@/services/api/labQueries";
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

describe("useCreateReport", () => {
  it("POSTs format+since+until and returns the 202 report_id", async () => {
    let body: unknown = null;
    let path = "";
    server.use(
      http.post("/api/v1/engagements/:id/reports", async ({ params, request }) => {
        path = typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");
        body = await request.json();
        return HttpResponse.json({ report_id: "rep-1", status: "pending" }, { status: 202 });
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useCreateReport(), { wrapper });
    result.current.mutate({
      engagementId: "eng-9",
      body: {
        format: "pdf",
        since: "2026-05-17T08:00:00.000Z",
        until: "2026-05-17T10:00:00.000Z",
      },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(path).toBe("eng-9");
    expect(body).toMatchObject({ format: "pdf" });
    expect(result.current.data?.report_id).toBe("rep-1");
  });
});

describe("useReportStatus", () => {
  it("returns the 200 ready status with download_url", async () => {
    server.use(
      http.get("/api/v1/engagements/:id/reports/:reportId", () =>
        HttpResponse.json({
          status: "ready",
          download_url: "/api/v1/engagements/eng-1/reports/r-1/download?token=sig",
        }),
      ),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useReportStatus("eng-1", "r-1"), { wrapper });
    await waitFor(() => expect(result.current.data?.status).toBe("ready"));
    expect(result.current.data?.download_url).toContain("download?token=");
  });

  it("polls a pending report and eventually surfaces ready", async () => {
    let calls = 0;
    server.use(
      http.get("/api/v1/engagements/:id/reports/:reportId", () => {
        calls += 1;
        if (calls < 2) return HttpResponse.json({ status: "pending" });
        return HttpResponse.json({
          status: "ready",
          download_url: "/dl/x?token=y",
        });
      }),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useReportStatus("eng-1", "r-2"), { wrapper });
    // Wait beyond the poll interval — TanStack Query refetches on its own.
    await waitFor(() => expect(result.current.data?.status).toBe("ready"), { timeout: 4000 });
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("is disabled until a reportId is supplied", () => {
    const { wrapper } = wrap();
    const { result } = renderHook(() => useReportStatus("eng-1", null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("surfaces failed status with error string from backend", async () => {
    server.use(
      http.get("/api/v1/engagements/:id/reports/:reportId", () =>
        HttpResponse.json({ status: "failed", error: "no events in window" }),
      ),
    );
    const { wrapper } = wrap();
    const { result } = renderHook(() => useReportStatus("eng-1", "r-fail"), { wrapper });
    await waitFor(() => expect(result.current.data?.status).toBe("failed"));
    expect(result.current.data?.error).toBe("no events in window");
  });
});
