import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ApiError, apiClient } from "./client";
import type { components } from "./openapi";

export type Pcap = components["schemas"]["Pcap"];
export type PcapStatus = components["schemas"]["PcapStatus"];
export type Finding = components["schemas"]["Finding"];
export type FindingKind = components["schemas"]["FindingKind"];
export type FindingSeverity = components["schemas"]["FindingSeverity"];
type AnalysisSummary = components["schemas"]["AnalysisSummaryResponse"];

interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

const PCAP_ROOT = ["pcaps"] as const;

function pcapsKey(engagementId: string): readonly unknown[] {
  return [...PCAP_ROOT, { engagement: engagementId }];
}

/**
 * List PCAPs scoped to one engagement (PR #56-65 backend). 403 means
 * the operator isn't authenticated for this engagement; surfaces as
 * `query.error?.status === 403` so the parent view can render an
 * explanatory empty state instead of an error toast.
 */
export function usePcaps(engagementId: string) {
  return useQuery<Page<Pcap>, ApiError>({
    queryKey: pcapsKey(engagementId),
    queryFn: () =>
      apiClient.get<Page<Pcap>>(`/engagements/${encodeURIComponent(engagementId)}/pcaps`),
    enabled: Boolean(engagementId),
    staleTime: 15_000,
  });
}

/**
 * Multipart PCAP upload (admin+TOTP+CSRF backend-gated). The body is
 * a FormData with one field, `file` (the .pcap or .pcapng). On
 * success the engagement's PCAP cache is invalidated so the list
 * shows the new row immediately.
 */
export function useUploadPcap(engagementId: string) {
  const qc = useQueryClient();
  return useMutation<Pcap, ApiError, File>({
    mutationFn: (file) => {
      const fd = new FormData();
      fd.append("file", file);
      return apiClient.upload<Pcap>(`/engagements/${encodeURIComponent(engagementId)}/pcaps`, fd);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pcapsKey(engagementId) });
    },
  });
}

/**
 * PCAP delete with a typed-confirm body (`PcapDeleteRequest.confirm =
 * "DELETE"` per backend contract). Admin+TOTP+CSRF gated.
 */
export function useDeletePcap(engagementId: string) {
  const qc = useQueryClient();
  return useMutation<void, ApiError, { pcapId: string; confirm: string }>({
    mutationFn: ({ pcapId, confirm }) =>
      apiClient.delete<void>(
        `/engagements/${encodeURIComponent(engagementId)}/pcaps/${encodeURIComponent(pcapId)}`,
        { confirm },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pcapsKey(engagementId) });
    },
  });
}

/**
 * Kick off a tshark analysis run for a stored PCAP. Returns an
 * `analysis_id` envelope; the caller polls `usePcapAnalysis(...)` for
 * status updates. Admin+TOTP gated.
 */
export function useAnalyzePcap(engagementId: string) {
  const qc = useQueryClient();
  return useMutation<{ analysis_id: string }, ApiError, string>({
    mutationFn: (pcapId) =>
      apiClient.post<{ analysis_id: string }>(
        `/engagements/${encodeURIComponent(engagementId)}/pcaps/${encodeURIComponent(pcapId)}/analyze`,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pcapsKey(engagementId) });
    },
  });
}

/**
 * Current analysis status + per-kind counts for a PCAP. Refetches
 * every 4s while `status === "analyzing"` so the operator's view
 * moves from "analyzing" to "analyzed" without a manual reload.
 */
export function usePcapAnalysis(engagementId: string, pcapId: string | null | undefined) {
  return useQuery<AnalysisSummary, ApiError>({
    queryKey: [...PCAP_ROOT, { engagement: engagementId, pcap: pcapId, kind: "analysis" }],
    queryFn: () =>
      apiClient.get<AnalysisSummary>(
        `/engagements/${encodeURIComponent(engagementId)}/pcaps/${encodeURIComponent(pcapId ?? "")}/analysis`,
      ),
    enabled: Boolean(engagementId && pcapId),
    refetchInterval: (q) => (q.state.data?.analysis?.status === "running" ? 4_000 : false),
  });
}

/**
 * Paginated findings list for a PCAP analysis. Authenticated operator.
 */
export function usePcapFindings(engagementId: string, pcapId: string | null | undefined) {
  return useQuery<Page<Finding>, ApiError>({
    queryKey: [...PCAP_ROOT, { engagement: engagementId, pcap: pcapId, kind: "findings" }],
    queryFn: () =>
      apiClient.get<Page<Finding>>(
        `/engagements/${encodeURIComponent(engagementId)}/pcaps/${encodeURIComponent(pcapId ?? "")}/findings`,
      ),
    enabled: Boolean(engagementId && pcapId),
    staleTime: 30_000,
  });
}
