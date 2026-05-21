import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@/services/api/openapi";
import { ApiError, apiClient } from "@/services/api/client";

export type UserPublic = components["schemas"]["UserPublic"];
export type LoginResponse = components["schemas"]["LoginResponse"];
export type LoginRequest = components["schemas"]["LoginRequest"];
export type TotpSetupResponse = components["schemas"]["TotpSetupResponse"];

export const AUTH_QUERY_KEY = ["auth", "currentUser"] as const;

/**
 * True when the backend has refused a state-changing call because the
 * caller's recent-TOTP claim has expired.
 *
 * Backend contract (see `apps/backend/.../api/v1/auth.py::setup_totp`
 * and any admin-gated endpoint): returns `403` with
 * `{"detail": "totp_required"}` when the operator has TOTP enabled
 * but `totp_verified_at` is older than `settings.totp_recent_minutes`.
 *
 * Callers that detect this state should render the `TotpStepUp`
 * prompt instead of leaking the raw error string. After the user
 * verifies a fresh code, the original action can be retried — the
 * step-up updates `totp_verified_at` server-side, so the next attempt
 * sees a fresh recent window.
 */
export function isTotpRequired(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status !== 403) return false;
  const body = err.body;
  if (body && typeof body === "object" && "detail" in body) {
    return body.detail === "totp_required";
  }
  return false;
}

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
 * Sign out the current operator.
 *
 * Calls `POST /api/v1/auth/logout`, which the backend uses to:
 *   1. Invalidate the access + refresh tokens server-side.
 *   2. Clear the `access_token`, `refresh_token`, and `csrf_token`
 *      cookies (Set-Cookie with `Max-Age=0`).
 *   3. Write an audit-log entry attributed to the actor.
 *
 * On the client we then clear the auth cache and remove every
 * server-state query that depended on the session so the next route
 * load starts cold. Any failure (network error, 401 from an already-
 * expired session, etc.) still flushes the local cache — the operator
 * shouldn't be stuck "signed in" client-side if the backend already
 * thinks the session is gone.
 */
export function useLogout() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, void>({
    mutationFn: async () => {
      try {
        await apiClient.post<undefined>("/auth/logout");
      } catch (err) {
        // 401 here means the session is already gone — treat as success
        // so the operator isn't blocked from clearing local state.
        if (!(err instanceof ApiError) || err.status !== 401) throw err;
      }
    },
    onSettled: () => {
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
      // The recent-TOTP claim is now fresh server-side. Any query that
      // previously failed with `403` (sensors, users, alert rules, lab,
      // audit, anything else that's admin-gated) is still holding that
      // cached error and will keep returning it until its staleTime
      // expires. Invalidate every 403-cached query so the next render
      // refetches and the gate clears without the operator having to
      // hard-refresh the page.
      // `invalidateQueries` returns a Promise that resolves once
      // every refetch has settled. We deliberately don't await it —
      // the verify mutation is allowed to return success the moment
      // the auth cache is updated; the dependent queries finish in
      // the background and the UI re-renders when each settles.
      void qc.invalidateQueries({
        predicate: (query) => {
          const err = query.state.error;
          return err instanceof ApiError && err.status === 403;
        },
      });
    },
  });
}
