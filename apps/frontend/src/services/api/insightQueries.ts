import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type ApiError, apiClient } from "./client";
import type { components } from "./openapi";

export type Insight = components["schemas"]["Insight"];

/**
 * The insight kinds the backend's `LlmInsightService` exposes named
 * methods for (PRs #66-70). Each maps 1:1 to a route under
 * `/api/v1/insights/{kind}/{entity_id}`.
 */
export type InsightKind =
  | "alert_context"
  | "engagement_summary"
  | "ap_description"
  | "pcap_finding";

/**
 * Reasons a 503 may come back. Surfaced through the hook as a typed
 * `unavailable` state so callers can render distinct UX per cause —
 * disabled vs budget vs validation vs client error.
 */
export type InsightUnavailableReason =
  | "disabled"
  | "budget_exceeded"
  | "client_error"
  | "validation_failed";

export interface InsightResult {
  available: boolean;
  insight?: Insight;
  reason?: InsightUnavailableReason;
}

const PATH_FOR: Record<InsightKind, (id: string) => string> = {
  alert_context: (id) => `/insights/alert/${encodeURIComponent(id)}`,
  engagement_summary: (id) => `/insights/engagement/${encodeURIComponent(id)}`,
  ap_description: (id) => `/insights/ap/${encodeURIComponent(id)}`,
  pcap_finding: (id) => `/insights/pcap-finding/${encodeURIComponent(id)}`,
};

const KEY_FOR = (kind: InsightKind, id: string): readonly unknown[] => ["insight", kind, id];

/**
 * Per-kind cache TTL. Backend cache is authoritative; these values
 * just tell TanStack Query how long to consider a result fresh in
 * the browser, sparing the operator a refetch when they bounce back
 * to a view. Conservative — server-cache will absorb the actual hit.
 */
const STALE_TIME: Record<InsightKind, number> = {
  alert_context: Infinity,
  engagement_summary: 60 * 60_000,
  ap_description: 24 * 60 * 60_000,
  pcap_finding: Infinity,
};

/**
 * Read an insight by entity id. 503 → `{ available: false, reason }`
 * (NOT thrown) so list views render a graceful unavailable card
 * rather than crashing. Genuine 401/404 still throw and surface via
 * `query.error`.
 */
export function useInsight(kind: InsightKind, entityId: string | null | undefined) {
  return useQuery<InsightResult, ApiError>({
    queryKey: KEY_FOR(kind, entityId ?? ""),
    enabled: Boolean(entityId),
    queryFn: async () => {
      try {
        const insight = await apiClient.get<Insight>(PATH_FOR[kind](entityId ?? ""));
        return { available: true, insight };
      } catch (err) {
        if (err instanceof Error && "status" in err && (err as ApiError).status === 503) {
          const body = (err as ApiError).body;
          const reason =
            body && typeof body === "object" && "reason" in body
              ? ((body as { reason?: string }).reason as InsightUnavailableReason)
              : "client_error";
          return { available: false, reason };
        }
        throw err;
      }
    },
    staleTime: STALE_TIME[kind],
    retry: false,
  });
}

/**
 * Admin-gated refresh. Server-side regenerates the insight bypassing
 * the cache. Invalidates the local query so the next read pulls the
 * fresh response.
 */
export function useRefreshInsight(kind: InsightKind) {
  const qc = useQueryClient();
  return useMutation<Insight, ApiError, string>({
    mutationFn: (entityId) =>
      apiClient.post<Insight>(
        `/insights/${encodeURIComponent(kind)}/${encodeURIComponent(entityId)}/refresh`,
      ),
    onSuccess: (_, entityId) => {
      void qc.invalidateQueries({ queryKey: KEY_FOR(kind, entityId) });
    },
  });
}

export type LlmUsage = components["schemas"]["LlmUsageResponse"];
export type KillSwitchState = components["schemas"]["KillSwitchResponse"];

const USAGE_KEY = ["insights", "usage"] as const;
const KILL_SWITCH_KEY = ["insights", "kill-switch"] as const;

/**
 * Admin-only LLM usage telemetry. 403 surfaces normally so the
 * settings panel can render a "you need to be admin" hint.
 */
export function useLlmUsage() {
  return useQuery<LlmUsage, ApiError>({
    queryKey: USAGE_KEY,
    queryFn: () => apiClient.get<LlmUsage>("/insights/usage"),
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * Admin-only runtime kill-switch toggle. The body's typed-confirm
 * (`ENABLE` / `DISABLE`) mirrors the backend's KillSwitchRequest
 * contract, matching the sensor-revoke and PCAP-delete patterns.
 */
export function useToggleKillSwitch() {
  const qc = useQueryClient();
  return useMutation<KillSwitchState, ApiError, { enable: boolean; confirm: "ENABLE" | "DISABLE" }>(
    {
      mutationFn: ({ enable, confirm }) =>
        apiClient.post<KillSwitchState>("/insights/kill-switch", { enable, confirm }),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: KILL_SWITCH_KEY });
        void qc.invalidateQueries({ queryKey: USAGE_KEY });
      },
    },
  );
}
