import { useQuery } from "@tanstack/react-query";
import { type ApiError, apiClient } from "./client";
import type { components } from "./openapi";

type Sensor = components["schemas"]["Sensor"];
type AccessPoint = components["schemas"]["AccessPoint"];
type Client = components["schemas"]["Client"];
type Event = components["schemas"]["Event"];

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

export type { Page, Sensor, AccessPoint, Client, Event };
