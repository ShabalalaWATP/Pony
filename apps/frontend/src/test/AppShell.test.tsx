import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { AppShell } from "@/components/layout/AppShell";
import { StubView } from "@/views/StubView";
import { useLabModeStore } from "@/stores/useLabModeStore";
import { useUIStore } from "@/stores/useUIStore";

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
    render(<RouterProvider router={makeRouter("/")} />);
    expect(await screen.findByLabelText("Cheeky Pony")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /open command palette/i }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
  });

  it("syncs lab-mode preview to data-lab-mode on the document root", async () => {
    render(<RouterProvider router={makeRouter("/")} />);
    await screen.findByLabelText("Cheeky Pony");
    expect(document.documentElement.dataset.labMode).toBe("false");
    useLabModeStore.setState({ preview: true });
    // The sync effect runs on the next render — force one by toggling another piece of state.
    useUIStore.setState({ sidebarCollapsed: true });
    await screen.findByLabelText("Cheeky Pony");
    expect(document.documentElement.dataset.labMode).toBe("true");
  });

  it("toggles the command palette via ⌘K", async () => {
    render(<RouterProvider router={makeRouter("/")} />);
    await screen.findByLabelText("Cheeky Pony");
    expect(useUIStore.getState().commandPaletteOpen).toBe(false);
    await userEvent.keyboard("{Meta>}k{/Meta}");
    expect(useUIStore.getState().commandPaletteOpen).toBe(true);
  });

  it("collapses sidebar on [ and expands on ]", async () => {
    render(<RouterProvider router={makeRouter("/")} />);
    await screen.findByLabelText("Cheeky Pony");
    // userEvent.keyboard treats [ and ] as chord delimiters — fireEvent
    // bypasses that parser for these reserved characters.
    fireEvent.keyDown(window, { key: "[" });
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
    fireEvent.keyDown(window, { key: "]" });
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });
});
