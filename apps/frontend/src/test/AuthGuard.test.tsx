import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { HttpResponse, http } from "msw";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { makeTestQueryClient } from "./helpers";
import { server } from "./msw/server";

/**
 * Build a router with both `/` (where the guard wraps the supplied UI)
 * and `/login` (so AuthGuard's `<Navigate to="/login">` lands on a real
 * route instead of infinite-looping in the matcher).
 */
function renderGuard(children: ReactNode): { qc: QueryClient } {
  const qc = makeTestQueryClient();
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <AuthGuard>{children}</AuthGuard>,
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "login",
    validateSearch: (s: Record<string, unknown>) => ({
      next: typeof s.next === "string" ? s.next : undefined,
    }),
    component: () => <div data-testid="login-route" />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, loginRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { qc };
}

describe("AuthGuard", () => {
  it("renders children when authenticated (default msw handlers)", async () => {
    renderGuard("guarded-content");
    expect(await screen.findByText("guarded-content")).toBeInTheDocument();
  });

  it("redirects to /login when not authenticated", async () => {
    server.use(
      http.post("/api/v1/auth/refresh", () =>
        HttpResponse.json({ detail: "Not auth" }, { status: 401 }),
      ),
    );
    renderGuard("guarded-content");
    expect(await screen.findByTestId("login-route")).toBeInTheDocument();
  });
});
