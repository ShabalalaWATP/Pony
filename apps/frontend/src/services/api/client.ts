/**
 * Lightweight typed fetch wrapper for the Cheeky Pony backend.
 *
 * Responsibilities:
 * - Sends credentials (cookies) on every request so the backend's
 *   httpOnly access/refresh JWT cookies flow.
 * - Reads the non-httpOnly `csrf_token` cookie and sets it as the
 *   `x-csrf-token` header on state-changing requests (per backend CSRF
 *   middleware contract: required on POST/PUT/PATCH to `/api/*` except
 *   `/auth/login`, `/auth/register`, `/auth/refresh`).
 * - On a single 401, attempts a refresh and retries the original. A
 *   second failure surfaces as `ApiError(401)` so callers can react
 *   (typically redirect to `/login`).
 * - Throws `ApiError` with a parsed body on non-2xx responses.
 *
 * Anything that needs an in-flight refresh deduplication (so a burst of
 * 401s does not fan out into many refresh calls) shares a single
 * `refreshPromise` module-local.
 */

const BASE = "/api/v1";

const PUBLIC_AUTH_PATHS = new Set(["/auth/login", "/auth/register", "/auth/refresh"]);

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Skip the 401 → refresh → retry dance (used by `/auth/refresh` itself). */
  skipRefresh?: boolean;
}

function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = /(?:^|;\s*)csrf_token=([^;]+)/.exec(document.cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function needsCsrf(method: string, path: string): boolean {
  const m = method.toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(m)) return false;
  return !PUBLIC_AUTH_PATHS.has(path);
}

let refreshInFlight: Promise<boolean> | null = null;

async function attemptRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const resp = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      return resp.ok;
    } finally {
      // Allow the next 401 to attempt refresh again, even if this one failed.
      // Held briefly to deduplicate the current burst.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();
  return refreshInFlight;
}

async function parseError(resp: Response): Promise<ApiError> {
  let body: unknown = null;
  let message = resp.statusText || `HTTP ${resp.status}`;
  try {
    const text = await resp.text();
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
        if (
          body &&
          typeof body === "object" &&
          "detail" in body &&
          typeof body.detail === "string"
        ) {
          message = (body as { detail: string }).detail;
        } else {
          message = text;
        }
      } catch {
        message = text;
      }
    }
  } catch {
    // Network/streaming error reading the body — fall back to statusText.
  }
  return new ApiError(resp.status, message, body);
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, skipRefresh, headers: incomingHeaders, method = "GET", ...rest } = options;
  const headers = new Headers(incomingHeaders);
  headers.set("Accept", "application/json");
  if (body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (needsCsrf(method, path)) {
    const csrf = readCsrfCookie();
    if (csrf) headers.set("x-csrf-token", csrf);
  }

  const init: RequestInit = {
    ...rest,
    method,
    headers,
    credentials: "include",
    body: body === undefined ? null : JSON.stringify(body),
  };

  const resp = await fetch(`${BASE}${path}`, init);

  if (
    resp.status === 401 &&
    !skipRefresh &&
    !PUBLIC_AUTH_PATHS.has(path) &&
    !path.startsWith("/auth/")
  ) {
    const refreshed = await attemptRefresh();
    if (refreshed) {
      return api<T>(path, { ...options, skipRefresh: true });
    }
    throw new ApiError(401, "Not authenticated", null);
  }

  if (!resp.ok) {
    throw await parseError(resp);
  }

  if (resp.status === 204) {
    return undefined as T;
  }
  return (await resp.json()) as T;
}

export const apiClient = {
  get: <T>(path: string, init?: RequestOptions) => api<T>(path, { ...init, method: "GET" }),
  post: <T>(path: string, body?: unknown, init?: RequestOptions) =>
    api<T>(path, { ...init, method: "POST", body }),
  put: <T>(path: string, body?: unknown, init?: RequestOptions) =>
    api<T>(path, { ...init, method: "PUT", body }),
  patch: <T>(path: string, body?: unknown, init?: RequestOptions) =>
    api<T>(path, { ...init, method: "PATCH", body }),
  delete: <T>(path: string, init?: RequestOptions) => api<T>(path, { ...init, method: "DELETE" }),
};
