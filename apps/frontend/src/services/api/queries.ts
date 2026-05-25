import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiClient } from "./client";
import type { components } from "./openapi";

// Alerts + alert rules live in `./alertQueries` — re-exported here so
// existing call sites that import from `services/api/queries` keep
// working without churn. Phase 4+ can migrate imports gradually.
export {
  useAlertsList,
  useAckAlert,
  useAlertRulesList,
  useCreateAlertRule,
  useUpdateAlertRule,
  useDeleteAlertRule,
  type Alert,
  type AlertRule,
  type AlertSeverity,
  type AlertsListParams,
} from "./alertQueries";

type Sensor = components["schemas"]["Sensor"];
type AccessPoint = components["schemas"]["AccessPoint"];
type Client = components["schemas"]["Client"];
type Event = components["schemas"]["Event"];
type SensorCommandAcceptedResponse = components["schemas"]["SensorCommandAcceptedResponse"];
type SetChannelRequest = components["schemas"]["SetChannelRequest"];
type SensorCapability = components["schemas"]["SensorCapability"];
type SensorRegisterRequest = components["schemas"]["SensorRegisterRequest"];
type SensorRegisterResponse = components["schemas"]["SensorRegisterResponse"];
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

/**
 * Single client device by MAC. Backend route:
 * `GET /api/v1/devices/{mac}`.
 *
 * Keyed by lowercase MAC for the same reason as the AP detail hook.
 * Disabled until a MAC is supplied; 404 surfaces as `error.status === 404`
 * for the deep-link-to-unknown-MAC case.
 */
export function useDeviceDetail(mac: string | null | undefined) {
  const normalised = mac?.toLowerCase() ?? "";
  return useQuery<Client, ApiError>({
    queryKey: ["devices", normalised, "detail"],
    queryFn: () => apiClient.get<Client>(`/devices/${encodeURIComponent(normalised)}`),
    enabled: Boolean(normalised),
    staleTime: PAGE_STALE_TIME,
    retry: (count, error) => {
      if (error.status === 401 || error.status === 403 || error.status === 404) return false;
      return count < 1;
    },
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
 * Evil-twin candidate list (backend PR #59). Same-SSID APs whose
 * vendor OUIs disagree — a strong "this might be a Pineapple-class
 * device" signal. Authenticated-operator gated (no admin needed) per
 * backend ADR — visibility of mismatches is a defensive concern.
 */
type EvilTwinCandidate = components["schemas"]["EvilTwinCandidate"];

export function useEvilTwinCandidates(pagination: Pagination = {}) {
  const { limit = 100, offset = 0 } = pagination;
  return useQuery<Page<EvilTwinCandidate>, ApiError>({
    queryKey: ["evil_twin_candidates", { limit, offset }],
    queryFn: () =>
      apiClient.get<Page<EvilTwinCandidate>>(
        withQuery("/access_points/evil-twin-candidates", { limit, offset }),
      ),
    staleTime: PAGE_STALE_TIME,
    retry: (count, error) => {
      if (error.status === 401 || error.status === 403) return false;
      return count < 1;
    },
  });
}

/**
 * Single access point by BSSID. Backend route:
 * `GET /api/v1/access_points/{bssid}`.
 *
 * Keyed by lowercase BSSID so the cache survives vendor-stack MAC-case
 * quirks. Disabled until a BSSID is supplied. A 404 (the detail page
 * deep-linked to a BSSID that hasn't been observed) surfaces as
 * `error.status === 404` so the drawer can render a "not found" empty
 * state without retrying.
 */
export function useAccessPointDetail(bssid: string | null | undefined) {
  const normalised = bssid?.toLowerCase() ?? "";
  return useQuery<AccessPoint, ApiError>({
    queryKey: ["access_points", normalised, "detail"],
    queryFn: () => apiClient.get<AccessPoint>(`/access_points/${encodeURIComponent(normalised)}`),
    enabled: Boolean(normalised),
    staleTime: PAGE_STALE_TIME,
    retry: (count, error) => {
      if (error.status === 401 || error.status === 403 || error.status === 404) return false;
      return count < 1;
    },
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

const SENSORS_ROOT_KEY = ["sensors"] as const;

interface RegisterSensorOptions {
  onSuccess?: (response: SensorRegisterResponse) => void;
}

export function useRegisterSensor(isActive = true) {
  const qc = useQueryClient();
  const active = useRef(isActive);
  const requestId = useRef(0);
  const [data, setData] = useState<SensorRegisterResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [isPending, setIsPending] = useState(false);
  active.current = isActive;

  useEffect(
    () => () => {
      active.current = false;
      requestId.current += 1;
    },
    [],
  );

  const reset = useCallback(() => {
    requestId.current += 1;
    setData(null);
    setError(null);
    setIsPending(false);
  }, []);

  const mutate = useCallback(
    (body: SensorRegisterRequest, options: RegisterSensorOptions = {}) => {
      const activeRequest = requestId.current + 1;
      requestId.current = activeRequest;
      setIsPending(true);
      setError(null);
      void apiClient
        .post<SensorRegisterResponse>("/sensors", body)
        .then((response) => {
          if (!active.current || requestId.current !== activeRequest) return;
          setData(response);
          options.onSuccess?.(response);
          void qc.invalidateQueries({ queryKey: SENSORS_ROOT_KEY });
        })
        .catch((err: unknown) => {
          if (!active.current || requestId.current !== activeRequest) return;
          setError(
            err instanceof ApiError
              ? err
              : new ApiError(
                  0,
                  err instanceof Error ? err.message : "Sensor registration failed",
                  null,
                ),
          );
        })
        .finally(() => {
          if (active.current && requestId.current === activeRequest) setIsPending(false);
        });
    },
    [qc],
  );

  return { data, error, isPending, mutate, reset };
}

/**
 * Revoke a sensor's certificate. Destructive — once revoked the sensor
 * can no longer connect to the backend gateway until re-registered. The
 * UI guards this behind a typed-confirm modal.
 */
export function useRevokeSensor() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => apiClient.post<undefined>(`/sensors/${encodeURIComponent(id)}/revoke`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SENSORS_ROOT_KEY });
    },
  });
}

// `AlertRuleCreateRequest` / `AlertRuleUpdateRequest` moved with the
// alerts hooks to `./alertQueries`. Re-export here for any consumer
// still importing them from this module so the split is non-breaking.
export type AlertRuleCreateRequest = components["schemas"]["AlertRuleCreateRequest"];
export type AlertRuleUpdateRequest = components["schemas"]["AlertRuleUpdateRequest"];

export type {
  Page,
  Sensor,
  AccessPoint,
  Client,
  Event,
  SensorCapability,
  SensorCommandAcceptedResponse,
  SensorRegisterRequest,
  SensorRegisterResponse,
  AuditLog,
};
