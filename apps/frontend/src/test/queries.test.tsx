import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  useAccessPointsList,
  useDevicesList,
  useEventsList,
  useSensorsList,
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
});
