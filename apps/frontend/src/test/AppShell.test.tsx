import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { AppShell } from "@/components/layout/AppShell";
import { StubView } from "@/views/StubView";
import { AUTH_QUERY_KEY } from "@/services/auth/hooks";
import { useLabModeStore } from "@/stores/useLabModeStore";
import { useUIStore } from "@/stores/useUIStore";
import { fixtures } from "./msw/handlers";
import { makeTestQueryClient } from "./helpers";

function makeRouter(initialPath = "/") {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const shellRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "shell",
    component: AppShell,
  });
  const indexRoute = createRoute({
    getParentRoute: () => shellRoute,
    path: "/",
    component: () => <StubView title="Overview" stage={4} description="test" />,
  });
  const sensorsRoute = createRoute({
    getParentRoute: () => shellRoute,
    path: "sensors",
    component: () => <StubView title="Sensors" stage={5} description="test" />,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([shellRoute.addChildren([indexRoute, sensorsRoute])]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
}

function renderAppShell(initialPath = "/"): QueryClient {
  const qc = makeTestQueryClient();
  qc.setQueryData(AUTH_QUERY_KEY, { csrf_token: fixtures.csrf, user: fixtures.user });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={makeRouter(initialPath)} />
    </QueryClientProvider>,
  );
  return qc;
}

beforeEach(() => {
  useUIStore.setState({
    sidebarCollapsed: false,
    commandPaletteOpen: false,
    cheatSheetOpen: false,
  });
  useLabModeStore.setState({ preview: false });
  delete document.documentElement.dataset.labMode;
});

describe("AppShell", () => {
  it("renders the sidebar, topbar, and current route content", async () => {
    renderAppShell();
    expect(await screen.findByLabelText("Cheeky Pony")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /open command palette/i }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
  });

  it("syncs lab-mode preview to data-lab-mode on the document root", async () => {
    renderAppShell();
    await screen.findByLabelText("Cheeky Pony");
    expect(document.documentElement.dataset.labMode).toBe("false");
    act(() => {
      useLabModeStore.setState({ preview: true });
      useUIStore.setState({ sidebarCollapsed: true });
    });
    await screen.findByLabelText("Cheeky Pony");
    expect(document.documentElement.dataset.labMode).toBe("true");
  });

  it("toggles the command palette via ⌘K", async () => {
    renderAppShell();
    await screen.findByLabelText("Cheeky Pony");
    expect(useUIStore.getState().commandPaletteOpen).toBe(false);
    await userEvent.keyboard("{Meta>}k{/Meta}");
    expect(useUIStore.getState().commandPaletteOpen).toBe(true);
  });

  it("collapses sidebar on [ and expands on ]", async () => {
    renderAppShell();
    await screen.findByLabelText("Cheeky Pony");
    act(() => {
      fireEvent.keyDown(window, { key: "[" });
    });
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
    act(() => {
      fireEvent.keyDown(window, { key: "]" });
    });
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });
});
