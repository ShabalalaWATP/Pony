import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@/services/api/openapi";
import { ApiError, apiClient } from "@/services/api/client";

export type UserPublic = components["schemas"]["UserPublic"];
export type LoginResponse = components["schemas"]["LoginResponse"];
export type LoginRequest = components["schemas"]["LoginRequest"];
export type TotpSetupResponse = components["schemas"]["TotpSetupResponse"];

export const AUTH_QUERY_KEY = ["auth", "currentUser"] as const;

/**
 * Authoritative source of the current session.
 *
 * We don't have a `/users/me` endpoint, so on cold load we attempt a
 * refresh — a 200 means the refresh-token cookie is valid and gives us
 * the user + a fresh csrf_token. A 401 means no session.
 *
 * After login or 2FA verify, mutation hooks `setQueryData` here so the
 * UI updates without another round-trip.
 */
export function useCurrentUser() {
  return useQuery<LoginResponse | null, ApiError>({
    queryKey: AUTH_QUERY_KEY,
    queryFn: async () => {
      try {
        return await apiClient.post<LoginResponse>("/auth/refresh");
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation<LoginResponse, ApiError, LoginRequest>({
    mutationFn: (req) => apiClient.post<LoginResponse>("/auth/login", req),
    onSuccess: (data) => qc.setQueryData(AUTH_QUERY_KEY, data),
  });
}

/**
 * Client-side logout. The backend currently doesn't expose `/auth/logout`,
 * so this clears local query state + leaves the cookies to expire.
 * Codex can wire a real revocation endpoint later — when they do, swap
 * the noop here for the `apiClient.post('/auth/logout')` call and the
 * UI will not change.
 */
export function useLogout() {
  const qc = useQueryClient();
  return useMutation<null, ApiError, void>({
    mutationFn: () => Promise.resolve(null),
    onSuccess: () => {
      qc.setQueryData(AUTH_QUERY_KEY, null);
      qc.removeQueries({ queryKey: ["sensors"] });
      qc.removeQueries({ queryKey: ["devices"] });
      qc.removeQueries({ queryKey: ["access_points"] });
      qc.removeQueries({ queryKey: ["events"] });
      qc.removeQueries({ queryKey: ["alerts"] });
    },
  });
}

export function useSetup2FA() {
  return useMutation<TotpSetupResponse, ApiError, void>({
    mutationFn: () => apiClient.post<TotpSetupResponse>("/auth/2fa/setup"),
  });
}

export function useVerify2FA() {
  const qc = useQueryClient();
  return useMutation<UserPublic, ApiError, string>({
    mutationFn: (code) => apiClient.post<UserPublic>("/auth/2fa/verify", { code }),
    onSuccess: (user) => {
      qc.setQueryData<LoginResponse | null>(AUTH_QUERY_KEY, (prev) =>
        prev ? { ...prev, user } : prev,
      );
    },
  });
}
