import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * Build a stand-alone query client with retries off — tests should never
 * wait for a flake-retry, and they should never share cache across cases.
 */
export function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // Long staleTime + Infinity gcTime so a single test's queries
        // don't refetch in a loop (causes "Maximum update depth exceeded"
        // in jsdom). Each test gets a fresh client anyway.
        staleTime: 60_000,
        gcTime: Infinity,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: { retry: false },
    },
  });
}

/**
 * Mount `ui` inside a minimal `RouterProvider` whose root route renders
 * `ui` directly. Useful for testing components that read
 * `useRouterState`, fire `useNavigate`, or render `<Link>` — but don't
 * care which route they're on.
 */
export function withRouter(ui: ReactNode, initialPath = "/"): JSX.Element {
  const rootRoute = createRootRoute({ component: () => <>{ui}</> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  return <RouterProvider router={router} />;
}

/**
 * `withRouter` + a fresh `QueryClient`. Use when the component under
 * test reads from TanStack Query.
 */
export function withQueryAndRouter(
  ui: ReactNode,
  opts: { qc?: QueryClient; initialPath?: string } = {},
): { qc: QueryClient; node: JSX.Element } {
  const qc = opts.qc ?? makeTestQueryClient();
  const node = (
    <QueryClientProvider client={qc}>{withRouter(ui, opts.initialPath)}</QueryClientProvider>
  );
  return { qc, node };
}

/**
 * A QueryClient-only wrapper, no router. Use when the component under
 * test reads from TanStack Query but does NOT touch router hooks
 * (`useNavigate`, `useSearch`). Mounts synchronously, which means
 * tests can use sync `screen.getBy*` queries straight after `render`
 * without waiting for the router's first tick.
 */
export function withQuery(
  ui: ReactNode,
  opts: { qc?: QueryClient } = {},
): { qc: QueryClient; node: JSX.Element } {
  const qc = opts.qc ?? makeTestQueryClient();
  const node = <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
  return { qc, node };
}
