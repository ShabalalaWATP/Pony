import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ApiError, apiClient } from "./client";
import type { components } from "./openapi";

type Sensor = components["schemas"]["Sensor"];
type AccessPoint = components["schemas"]["AccessPoint"];
type Client = components["schemas"]["Client"];
type Event = components["schemas"]["Event"];
type Alert = components["schemas"]["Alert"];
type AlertRule = components["schemas"]["AlertRule"];
type AlertSeverity = components["schemas"]["AlertSeverity"];
type AlertRuleCreateRequest = components["schemas"]["AlertRuleCreateRequest"];
type AlertRuleUpdateRequest = components["schemas"]["AlertRuleUpdateRequest"];
type SensorCommandAcceptedResponse = components["schemas"]["SensorCommandAcceptedResponse"];
type SetChannelRequest = components["schemas"]["SetChannelRequest"];
type AuditLog = components["schemas"]["AuditLog"];

/**
 * Bands the backend's `SetChannelRequest` accepts. Re-exported from
 * the generated OpenAPI types so the union (`"2.4" | "5" | "6"`)
 * stays in sync with the backend without a hand-rolled literal.
 */
export type ChannelBand = SetChannelRequest["band"];

export interface SetChannelArgs {
  id: string;
  channel: number;
  band: ChannelBand;
}

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

function withQuery(path: string, params: Pagination = {}): string {
  const search = new URLSearchParams();
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.offset !== undefined) search.set("offset", String(params.offset));
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

interface AlertsListParams extends Pagination {
  severity?: AlertSeverity[];
  /** `true` → acked only, `false` → unacked only, omit → all. */
  acked?: boolean;
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

const PAGE_STALE_TIME = 30_000;

/**
 * Devices (WiFi clients) list — paginated. The hook always succeeds at
 * the type level; callers inspect `error?.status` to handle 403s.
 */
export function useDevicesList(pagination: Pagination = {}) {
  const { limit = 100, offset = 0 } = pagination;
  return useQuery<Page<Client>, ApiError>({
    queryKey: ["devices", { limit, offset }],
    queryFn: () => apiClient.get<Page<Client>>(withQuery("/devices", { limit, offset })),
    staleTime: PAGE_STALE_TIME,
  });
}

export function useAccessPointsList(pagination: Pagination = {}) {
  const { limit = 100, offset = 0 } = pagination;
  return useQuery<Page<AccessPoint>, ApiError>({
    queryKey: ["access_points", { limit, offset }],
    queryFn: () => apiClient.get<Page<AccessPoint>>(withQuery("/access_points", { limit, offset })),
    staleTime: PAGE_STALE_TIME,
  });
}

/**
 * Clients currently (or recently) associated with a specific access
 * point. Backend route: `GET /api/v1/access_points/{bssid}/clients`.
 *
 * The hook is keyed by lower-cased BSSID so the cache survives the
 * MAC-case quirks seen in different vendor stacks. Disabled until a
 * BSSID is supplied to avoid a wasted request the moment a drawer
 * mounts before its row is selected.
 */
export function useApAssociatedClients(
  bssid: string | null | undefined,
  pagination: Pagination = {},
) {
  const { limit = 100, offset = 0 } = pagination;
  const normalised = bssid?.toLowerCase() ?? "";
  return useQuery<Page<Client>, ApiError>({
    queryKey: ["access_points", normalised, "clients", { limit, offset }],
    queryFn: () =>
      apiClient.get<Page<Client>>(
        withQuery(`/access_points/${encodeURIComponent(normalised)}/clients`, { limit, offset }),
      ),
    enabled: Boolean(normalised),
    staleTime: PAGE_STALE_TIME,
  });
}

export function useEventsList(pagination: Pagination = {}) {
  const { limit = 50, offset = 0 } = pagination;
  return useQuery<Page<Event>, ApiError>({
    queryKey: ["events", { limit, offset }],
    queryFn: () => apiClient.get<Page<Event>>(withQuery("/events", { limit, offset })),
    staleTime: 10_000,
  });
}

/**
 * Paginated audit log. Backend currently only supports `limit` /
 * `offset` — `actor` / `action` / `outcome` filtering is done
 * client-side against the returned page. Surface a 401/403 to the
 * caller without retrying so the view can render an explanatory
 * empty state instead of looking like a flake.
 */
export function useAuditList(pagination: Pagination = {}) {
  const { limit = 200, offset = 0 } = pagination;
  return useQuery<Page<AuditLog>, ApiError>({
    queryKey: ["audit", { limit, offset }],
    queryFn: () => apiClient.get<Page<AuditLog>>(withQuery("/audit", { limit, offset })),
    staleTime: PAGE_STALE_TIME,
    retry: (count, error) => {
      if (error.status === 401 || error.status === 403) return false;
      return count < 1;
    },
  });
}

/**
 * Sensors list. The backend gates this on admin + 2FA, so a vanilla
 * operator will see a 403 — surfaced as `error.status === 403`. The
 * Overview tile renders an em-dash with a tooltip in that case.
 */
export function useSensorsList(pagination: Pagination = {}) {
  const { limit = 100, offset = 0 } = pagination;
  return useQuery<Page<Sensor>, ApiError>({
    queryKey: ["sensors", { limit, offset }],
    queryFn: () => apiClient.get<Page<Sensor>>(withQuery("/sensors", { limit, offset })),
    staleTime: PAGE_STALE_TIME,
    retry: (count, error) => {
      // Don't retry on auth/authorization failures.
      if (error.status === 401 || error.status === 403) return false;
      return count < 1;
    },
  });
}

const ALERTS_ROOT_KEY = ["alerts"] as const;
const ALERT_RULES_ROOT_KEY = ["alert_rules"] as const;

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
 * Acknowledge an alert. On success, both the alerts and (cached) rules
 * queries are invalidated so the inbox + Overview tile reflect the new
 * `acked_by` / `acked_at` state without a manual refetch.
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

/**
 * Send a sensor-lifecycle command. The backend returns 202 + a
 * `command_id`; the actual outcome arrives later on the operator
 * WebSocket as a `command_result` event. Each helper hits a different
 * sub-route but otherwise has the same shape.
 *
 * All three endpoints require admin + recent 2FA + CSRF — surfaced as
 * an `ApiError(403)` so the UI can fall back to an explanatory message.
 */
export function useRestartSensor() {
  return useMutation<SensorCommandAcceptedResponse, ApiError, string>({
    mutationFn: (id) =>
      apiClient.post<SensorCommandAcceptedResponse>(
        `/sensors/${encodeURIComponent(id)}/commands/restart`,
      ),
  });
}

export function useUpdateSensor() {
  return useMutation<SensorCommandAcceptedResponse, ApiError, string>({
    mutationFn: (id) =>
      apiClient.post<SensorCommandAcceptedResponse>(
        `/sensors/${encodeURIComponent(id)}/commands/update`,
      ),
  });
}

export function useSetSensorChannel() {
  return useMutation<SensorCommandAcceptedResponse, ApiError, SetChannelArgs>({
    mutationFn: ({ id, channel, band }) =>
      apiClient.post<SensorCommandAcceptedResponse>(
        `/sensors/${encodeURIComponent(id)}/commands/set-channel`,
        { channel, band },
      ),
  });
}

export type {
  Page,
  Sensor,
  AccessPoint,
  Client,
  Event,
  Alert,
  AlertRule,
  AlertSeverity,
  AlertRuleCreateRequest,
  AlertRuleUpdateRequest,
  SensorCommandAcceptedResponse,
  AuditLog,
};
