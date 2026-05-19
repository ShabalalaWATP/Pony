import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ApiError, apiClient } from "./client";
import type { components } from "./openapi";

type UserPublic = components["schemas"]["UserPublic"];
type UserUpdateRequest = components["schemas"]["UserUpdateRequest"];

interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

interface Pagination {
  limit?: number;
  offset?: number;
}

export const USERS_LIST_KEY = ["users"] as const;

function withQuery(path: string, params: Pagination): string {
  const search = new URLSearchParams();
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.offset !== undefined) search.set("offset", String(params.offset));
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Admin-only paginated user list. Backed by `GET /api/v1/users`.
 *
 * The backend gates this on admin + recent TOTP and returns 403 for
 * anyone else — surfaced as `error.status === 403` so the view can
 * render the explanatory empty state instead of looking like a flake.
 * The list is the source of truth for both the table and the per-row
 * edit drawer; the PATCH mutation invalidates this key on success so
 * the row's roles/TOTP state refreshes automatically.
 */
export function useUsersList(pagination: Pagination = {}) {
  const { limit = 100, offset = 0 } = pagination;
  return useQuery<Page<UserPublic>, ApiError>({
    queryKey: [...USERS_LIST_KEY, { limit, offset }],
    queryFn: () => apiClient.get<Page<UserPublic>>(withQuery("/users", { limit, offset })),
    staleTime: 30_000,
    retry: (count, error) => {
      if (error.status === 401 || error.status === 403) return false;
      return count < 1;
    },
  });
}

/**
 * Update a user's roles and/or reset their TOTP. Backed by
 * `PATCH /api/v1/users/{user_id}`.
 *
 * Admin + recent 2FA + CSRF gated server-side. The backend enforces
 * a "last admin" guard (409 if the caller is removing the admin role
 * from themselves and no other admin exists) and a roles whitelist
 * (422 for any role outside `{operator, admin}`) — both surface
 * inline in the edit drawer with the body's `detail` text.
 *
 * Every successful update writes an audit log entry server-side, so
 * we don't need to log on the client.
 */
export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation<UserPublic, ApiError, { id: string; patch: UserUpdateRequest }>({
    mutationFn: ({ id, patch }) =>
      apiClient.patch<UserPublic>(`/users/${encodeURIComponent(id)}`, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: USERS_LIST_KEY });
    },
  });
}

export type { UserPublic, UserUpdateRequest };
