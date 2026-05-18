import { useQuery } from "@tanstack/react-query";
import { type ApiError, apiClient } from "./client";
import type { components } from "./openapi";

type DemoStatusResponse = components["schemas"]["DemoStatusResponse"];

export const DEMO_STATUS_KEY = ["system", "demo-status"] as const;

/**
 * Whether (and how much) synthetic seed data is currently loaded.
 *
 * Backed by `GET /api/v1/system/demo-status`. The endpoint is
 * authenticated but otherwise unprivileged — every signed-in operator
 * needs to know if the data they're seeing is real or seeded so they
 * don't act on demo telemetry by mistake.
 *
 * A 404 (older backend without the endpoint) or transient network
 * failure resolves to `null` rather than throwing — the demo banner
 * graceful-degrades to "not shown" instead of blocking the UI.
 */
export function useDemoStatus() {
  return useQuery<DemoStatusResponse | null, ApiError>({
    queryKey: DEMO_STATUS_KEY,
    queryFn: async () => {
      try {
        return await apiClient.get<DemoStatusResponse>("/system/demo-status");
      } catch (err) {
        const status = (err as { status?: number }).status;
        // 404 → backend predates Stage 9a; 401/403 → not signed in yet
        // (the banner is wrapped in AuthGuard, but be defensive).
        if (status === 404 || status === 401 || status === 403) return null;
        throw err;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export type { DemoStatusResponse };
