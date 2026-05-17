import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ApiError, apiClient } from "./client";
import type { components } from "./openapi";

type Engagement = components["schemas"]["Engagement"];
type AllowTargetRequest = components["schemas"]["AllowTargetRequest"];
type LabModule = components["schemas"]["LabModule"];
type LabActiveCommand = components["schemas"]["LabActiveCommand"];
type LabModuleStartRequest = components["schemas"]["LabModuleStartRequest"];
type LabModuleStartResponse = components["schemas"]["LabModuleStartResponse"];
type TargetKind = components["schemas"]["TargetKind"];

interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export const ENGAGEMENT_ACTIVE_KEY = ["engagement", "active"] as const;
export const LAB_ACTIVE_KEY = ["lab", "active"] as const;

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

export function useAddAllowListTarget() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, { engagementId: string; payload: AllowTargetRequest }>({
    mutationFn: ({ engagementId, payload }) =>
      apiClient.post<undefined>(
        `/engagements/${encodeURIComponent(engagementId)}/allow-list`,
        payload,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ENGAGEMENT_ACTIVE_KEY });
    },
  });
}

export function useEndEngagement() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => apiClient.post<undefined>(`/engagements/${encodeURIComponent(id)}/end`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ENGAGEMENT_ACTIVE_KEY });
      void qc.invalidateQueries({ queryKey: LAB_ACTIVE_KEY });
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

export type {
  Engagement,
  AllowTargetRequest,
  LabModule,
  LabActiveCommand,
  LabModuleStartRequest,
  LabModuleStartResponse,
  TargetKind,
};
