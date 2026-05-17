import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ApiError, apiClient } from "./client";
import type { components } from "./openapi";

type Engagement = components["schemas"]["Engagement"];
type AllowTargetRequest = components["schemas"]["AllowTargetRequest"];
type AllowedTarget = components["schemas"]["AllowedTarget"];
type LabModule = components["schemas"]["LabModule"];
type LabActiveCommand = components["schemas"]["LabActiveCommand"];
type LabModuleStartRequest = components["schemas"]["LabModuleStartRequest"];
type LabModuleStartResponse = components["schemas"]["LabModuleStartResponse"];
type LabStatusResponse = components["schemas"]["LabStatusResponse"];
type TargetKind = components["schemas"]["TargetKind"];
type ReportCreateRequest = components["schemas"]["ReportCreateRequest"];
type ReportCreateResponse = components["schemas"]["ReportCreateResponse"];
type ReportStatusResponse = components["schemas"]["ReportStatusResponse"];
type ReportFormat = components["schemas"]["ReportFormat"];
type ReportStatus = components["schemas"]["ReportStatus"];

interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export const ENGAGEMENT_ACTIVE_KEY = ["engagement", "active"] as const;
export const ENGAGEMENTS_LIST_KEY = ["engagements"] as const;
export const LAB_ACTIVE_KEY = ["lab", "active"] as const;
export const LAB_STATUS_KEY = ["lab", "status"] as const;
const allowListKey = (engagementId: string): readonly unknown[] =>
  ["engagement", engagementId, "allow-list"] as const;

/**
 * Structured 403 body the backend emits for every active-gate refusal.
 * The `reason` values match the gate enum (`lab_mode_disabled`,
 * `no_acknowledgement`, `admin_required`, `missing_2fa`,
 * `no_active_engagement`, `target_not_in_allowlist`, `gate_error`,
 * `active_command_not_found`); `detail` is the human-readable copy.
 */
export interface LabRefusalBody {
  reason: string;
  detail: string;
}

export function isLabRefusal(body: unknown): body is LabRefusalBody {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { reason?: unknown }).reason === "string" &&
    typeof (body as { detail?: unknown }).detail === "string"
  );
}

/**
 * Active engagement, the one all lab actions implicitly target. The
 * backend returns 404 when no engagement is active — surfaced as
 * `error.status === 404`.
 */
export function useActiveEngagement() {
  return useQuery<Engagement, ApiError>({
    queryKey: ENGAGEMENT_ACTIVE_KEY,
    queryFn: () => apiClient.get<Engagement>("/engagements/active"),
    staleTime: 30_000,
    retry: (count, error) => {
      if (error.status === 401 || error.status === 403 || error.status === 404) return false;
      return count < 1;
    },
  });
}

/**
 * Paginated engagements list (active + ended). Powers `/engagements`
 * where the operator picks one to resume or audit.
 */
export function useEngagementsList(pagination: { limit?: number; offset?: number } = {}) {
  const { limit = 100, offset = 0 } = pagination;
  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) }).toString();
  return useQuery<Page<Engagement>, ApiError>({
    queryKey: [...ENGAGEMENTS_LIST_KEY, { limit, offset }],
    queryFn: () => apiClient.get<Page<Engagement>>(`/engagements?${qs}`),
    staleTime: 30_000,
    retry: (count, error) => {
      if (error.status === 401 || error.status === 403) return false;
      return count < 1;
    },
  });
}

/**
 * Live allow-list for an engagement. `enabled` is keyed on the id so
 * the hook stays idle until the engagement is known. The backend
 * paginates; the lab UI only needs the first 200 entries — anything
 * larger is an operations smell and would page in the audit log.
 */
export function useAllowList(engagementId: string | null | undefined) {
  return useQuery<Page<AllowedTarget>, ApiError>({
    queryKey: allowListKey(engagementId ?? ""),
    queryFn: () =>
      apiClient.get<Page<AllowedTarget>>(
        `/engagements/${encodeURIComponent(engagementId ?? "")}/allow-list?limit=200`,
      ),
    enabled: Boolean(engagementId),
    staleTime: 10_000,
    retry: (count, error) => {
      if (error.status === 401 || error.status === 403 || error.status === 404) return false;
      return count < 1;
    },
  });
}

export function useAddAllowListTarget() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, { engagementId: string; payload: AllowTargetRequest }>({
    mutationFn: ({ engagementId, payload }) =>
      apiClient.post<undefined>(
        `/engagements/${encodeURIComponent(engagementId)}/allow-list`,
        payload,
      ),
    onSuccess: (_data, { engagementId }) => {
      void qc.invalidateQueries({ queryKey: ENGAGEMENT_ACTIVE_KEY });
      void qc.invalidateQueries({ queryKey: allowListKey(engagementId) });
    },
  });
}

export function useRemoveAllowListTarget() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, { engagementId: string; payload: AllowTargetRequest }>({
    mutationFn: ({ engagementId, payload }) =>
      apiClient.delete<undefined>(
        `/engagements/${encodeURIComponent(engagementId)}/allow-list`,
        payload,
      ),
    onSuccess: (_data, { engagementId }) => {
      void qc.invalidateQueries({ queryKey: allowListKey(engagementId) });
    },
  });
}

export function useEndEngagement() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => apiClient.post<undefined>(`/engagements/${encodeURIComponent(id)}/end`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ENGAGEMENT_ACTIVE_KEY });
      void qc.invalidateQueries({ queryKey: ENGAGEMENTS_LIST_KEY });
      void qc.invalidateQueries({ queryKey: LAB_ACTIVE_KEY });
    },
  });
}

/**
 * Resume an ended engagement. Only succeeds when no other engagement
 * is currently active — the backend enforces that invariant.
 */
export function useResumeEngagement() {
  const qc = useQueryClient();
  return useMutation<Engagement, ApiError, string>({
    mutationFn: (id) => apiClient.post<Engagement>(`/engagements/${encodeURIComponent(id)}/resume`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ENGAGEMENT_ACTIVE_KEY });
      void qc.invalidateQueries({ queryKey: ENGAGEMENTS_LIST_KEY });
    },
  });
}

/**
 * Reads the four lab-gate flags up-front so the UI can show *why* the
 * lab is unavailable before the operator tries to fire a module. We
 * don't infer state from a 403 anymore — that was lossy.
 *
 * Stays at 200 even when gates fail; treat 401/403 as "no access" and
 * skip retries for them. Network 5xx retries once.
 */
export function useLabStatus() {
  return useQuery<LabStatusResponse, ApiError>({
    queryKey: LAB_STATUS_KEY,
    queryFn: () => apiClient.get<LabStatusResponse>("/lab/status"),
    staleTime: 15_000,
    retry: (count, error) => {
      if (error.status === 401 || error.status === 403) return false;
      return count < 1;
    },
  });
}

/** Page of currently-running lab commands across the tailnet. */
export function useActiveLabCommands() {
  return useQuery<Page<LabActiveCommand>, ApiError>({
    queryKey: LAB_ACTIVE_KEY,
    queryFn: () => apiClient.get<Page<LabActiveCommand>>("/lab/active?limit=100"),
    staleTime: 10_000,
    retry: (count, error) => {
      if (error.status === 401 || error.status === 403) return false;
      return count < 1;
    },
  });
}

export interface StartLabModuleArgs {
  module: LabModule;
  body: LabModuleStartRequest;
}

export function useStartLabModule() {
  const qc = useQueryClient();
  return useMutation<LabModuleStartResponse, ApiError, StartLabModuleArgs>({
    mutationFn: ({ module, body }) =>
      apiClient.post<LabModuleStartResponse>(`/lab/${encodeURIComponent(module)}/start`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LAB_ACTIVE_KEY });
    },
  });
}

export interface StopLabModuleArgs {
  module: LabModule;
  commandId: string;
}

export function useStopLabModule() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, StopLabModuleArgs>({
    mutationFn: ({ module, commandId }) =>
      apiClient.post<undefined>(
        `/lab/${encodeURIComponent(module)}/stop/${encodeURIComponent(commandId)}`,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LAB_ACTIVE_KEY });
    },
  });
}

export interface CreateReportArgs {
  engagementId: string;
  body: ReportCreateRequest;
}

/**
 * Kick off an engagement report. Backend returns 202 + `report_id` and
 * the actual generation runs asynchronously — callers immediately
 * follow up with `useReportStatus(engagementId, report_id)` to poll
 * until the status flips to `ready` or `failed`.
 */
export function useCreateReport() {
  return useMutation<ReportCreateResponse, ApiError, CreateReportArgs>({
    mutationFn: ({ engagementId, body }) =>
      apiClient.post<ReportCreateResponse>(
        `/engagements/${encodeURIComponent(engagementId)}/reports`,
        body,
      ),
  });
}

/** Poll cadence for in-flight reports. 1.5s mirrors live-data §9. */
const REPORT_POLL_MS = 1500;

/**
 * Poll one report until it lands. The `refetchInterval` callback
 * returns `false` once the backend reports a terminal state, which
 * stops the polling without unsubscribing the query.
 *
 * `enabled` is wired to the truthiness of `reportId` so the caller
 * can mount the hook before they have an id without firing a
 * request against `.../reports/undefined`.
 */
export function useReportStatus(engagementId: string, reportId: string | null | undefined) {
  return useQuery<ReportStatusResponse, ApiError>({
    queryKey: ["reports", engagementId, reportId ?? ""],
    queryFn: () =>
      apiClient.get<ReportStatusResponse>(
        `/engagements/${encodeURIComponent(engagementId)}/reports/${encodeURIComponent(
          reportId ?? "",
        )}`,
      ),
    enabled: Boolean(reportId),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === "ready" || status === "failed" ? false : REPORT_POLL_MS;
    },
    staleTime: 0,
  });
}

export type {
  Engagement,
  AllowTargetRequest,
  AllowedTarget,
  LabModule,
  LabActiveCommand,
  LabModuleStartRequest,
  LabModuleStartResponse,
  LabStatusResponse,
  TargetKind,
  ReportCreateRequest,
  ReportCreateResponse,
  ReportStatusResponse,
  ReportFormat,
  ReportStatus,
};
