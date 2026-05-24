import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ApiError, apiClient } from "./client";
import type { components } from "./openapi";

export type Alert = components["schemas"]["Alert"];
export type AlertRule = components["schemas"]["AlertRule"];
export type AlertSeverity = components["schemas"]["AlertSeverity"];
type AlertRuleCreateRequest = components["schemas"]["AlertRuleCreateRequest"];
type AlertRuleUpdateRequest = components["schemas"]["AlertRuleUpdateRequest"];

interface Pagination {
  limit?: number;
  offset?: number;
}

interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface AlertsListParams extends Pagination {
  severity?: AlertSeverity[];
  /** `true` → acked only, `false` → unacked only, omit → all. */
  acked?: boolean;
}

const PAGE_STALE_TIME = 30_000;
const ALERTS_ROOT_KEY = ["alerts"] as const;
const ALERT_RULES_ROOT_KEY = ["alert_rules"] as const;

function withQuery(path: string, params: Pagination): string {
  const search = new URLSearchParams();
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.offset !== undefined) search.set("offset", String(params.offset));
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

function withAlertQuery(path: string, params: AlertsListParams): string {
  const search = new URLSearchParams();
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.offset !== undefined) search.set("offset", String(params.offset));
  for (const s of params.severity ?? []) search.append("severity", s);
  if (params.acked !== undefined) search.set("acked", String(params.acked));
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Paginated list of alerts. Supports filtering by severity (repeated
 * query param) and ack state. The query key embeds the filters so
 * different filter combinations cache separately.
 */
export function useAlertsList(params: AlertsListParams = {}) {
  const { limit = 100, offset = 0, severity, acked } = params;
  const filters = { limit, offset, severity: severity ?? [], acked };
  return useQuery<Page<Alert>, ApiError>({
    queryKey: [...ALERTS_ROOT_KEY, filters],
    queryFn: () => apiClient.get<Page<Alert>>(withAlertQuery("/alerts", filters)),
    staleTime: 10_000,
  });
}

/**
 * Acknowledge an alert. On success the alerts query is invalidated so
 * the inbox + Overview tile reflect the new `acked_by` / `acked_at`
 * state without a manual refetch.
 */
export function useAckAlert() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (alertId) =>
      apiClient.post<undefined>(`/alerts/${encodeURIComponent(alertId)}/ack`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ALERTS_ROOT_KEY });
    },
  });
}

/**
 * Paginated list of alert rules. Rule management is admin-gated on the
 * backend so a vanilla operator may see a 403 — callers inspect
 * `error.status` and render an explanatory empty state.
 */
export function useAlertRulesList(pagination: Pagination = {}) {
  const { limit = 100, offset = 0 } = pagination;
  return useQuery<Page<AlertRule>, ApiError>({
    queryKey: [...ALERT_RULES_ROOT_KEY, { limit, offset }],
    queryFn: () => apiClient.get<Page<AlertRule>>(withQuery("/alerts/rules", { limit, offset })),
    staleTime: PAGE_STALE_TIME,
    retry: (count, error) => {
      if (error.status === 401 || error.status === 403) return false;
      return count < 1;
    },
  });
}

export function useCreateAlertRule() {
  const qc = useQueryClient();
  return useMutation<AlertRule, ApiError, AlertRuleCreateRequest>({
    mutationFn: (req) => apiClient.post<AlertRule>("/alerts/rules", req),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ALERT_RULES_ROOT_KEY });
    },
  });
}

export function useUpdateAlertRule() {
  const qc = useQueryClient();
  return useMutation<AlertRule, ApiError, { id: string; patch: AlertRuleUpdateRequest }>({
    mutationFn: ({ id, patch }) =>
      apiClient.patch<AlertRule>(`/alerts/rules/${encodeURIComponent(id)}`, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ALERT_RULES_ROOT_KEY });
    },
  });
}

export function useDeleteAlertRule() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => apiClient.delete<undefined>(`/alerts/rules/${encodeURIComponent(id)}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ALERT_RULES_ROOT_KEY });
    },
  });
}
