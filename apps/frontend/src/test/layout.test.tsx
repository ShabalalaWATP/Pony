import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { CheatSheet } from "@/components/layout/CheatSheet";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { LabModeBanner } from "@/components/layout/LabModeBanner";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { useLabModeStore } from "@/stores/useLabModeStore";
import { useUIStore } from "@/stores/useUIStore";

/**
 * Render a component inside a minimal TanStack Router test harness so
 * `useNavigate` / `useRouterState` / `<Link>` don't blow up.
 */
function withRouter(ui: ReactNode, initialPath = "/"): JSX.Element {
  const rootRoute = createRootRoute({ component: () => <>{ui}</> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  return <RouterProvider router={router} />;
}

beforeEach(() => {
  useUIStore.setState({
    sidebarCollapsed: false,
    commandPaletteOpen: false,
    cheatSheetOpen: false,
  });
  useLabModeStore.setState({ preview: false });
});

describe("Breadcrumbs", () => {
  it("renders 'Overview' at the root", async () => {
    render(withRouter(<Breadcrumbs />, "/"));
    expect(await screen.findByText("Overview")).toBeInTheDocument();
  });

  it("renders nested segments with the known title", async () => {
    render(withRouter(<Breadcrumbs />, "/sensors/wlan-pi-01"));
    expect(await screen.findByText("Sensors")).toBeInTheDocument();
    expect(await screen.findByText("wlan-pi-01")).toBeInTheDocument();
  });
});

describe("Sidebar", () => {
  it("renders the wordmark and the Recon group when expanded", async () => {
    render(withRouter(<Sidebar />));
    expect(await screen.findByLabelText("Cheeky Pony")).toBeInTheDocument();
    expect(await screen.findByText("Recon")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /Overview/i })).toBeInTheDocument();
  });

  it("hides the Lab item until preview is on", async () => {
    const { rerender } = render(withRouter(<Sidebar />));
    // Wait for first render to settle then assert.
    await screen.findByText("Recon");
    expect(screen.queryByRole("link", { name: /Lab/i })).toBeNull();

    useLabModeStore.setState({ preview: true });
    rerender(withRouter(<Sidebar />));
    expect((await screen.findAllByRole("link", { name: /Lab/i })).length).toBeGreaterThan(0);
  });

  it("collapses to icon-only when sidebarCollapsed is true", async () => {
    useUIStore.setState({ sidebarCollapsed: true });
    render(withRouter(<Sidebar />));
    // Wait for the icon-only render — wordmark glyph still has the aria-label.
    await screen.findByLabelText("Cheeky Pony");
    expect(screen.queryByText("Recon")).toBeNull();
  });
});

describe("Topbar", () => {
  it("opens the palette when the Jump-to pill is clicked", async () => {
    render(withRouter(<Topbar />));
    const pill = await screen.findByRole("button", { name: /open command palette/i });
    await userEvent.click(pill);
    expect(useUIStore.getState().commandPaletteOpen).toBe(true);
  });

  it("toggles the sidebar via the panel button", async () => {
    render(withRouter(<Topbar />));
    const button = await screen.findByRole("button", { name: /collapse sidebar/i });
    await userEvent.click(button);
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
  });
});

describe("LabModeBanner", () => {
  it("renders nothing when preview is off", () => {
    const { container } = render(<LabModeBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders when preview is on", () => {
    useLabModeStore.setState({ preview: true });
    render(<LabModeBanner />);
    expect(screen.getByText(/lab mode preview/i)).toBeInTheDocument();
  });
});

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    const { container } = render(withRouter(<CommandPalette />));
    expect(container.firstChild).toBeNull();
  });

  it("opens, shows Navigate group, and closes on Escape", async () => {
    useUIStore.setState({ commandPaletteOpen: true });
    render(withRouter(<CommandPalette />));
    expect(await screen.findByRole("dialog", { name: /command palette/i })).toBeInTheDocument();
    expect(await screen.findByText("Navigate")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(useUIStore.getState().commandPaletteOpen).toBe(false);
  });

  it("dispatches each palette item's perform handler", async () => {
    useUIStore.setState({ commandPaletteOpen: true });
    render(withRouter(<CommandPalette />));
    await screen.findByRole("dialog", { name: /command palette/i });
    const items = screen.getAllByRole("option");
    expect(items.length).toBeGreaterThanOrEqual(14);

    for (const item of items) {
      // Click closes the palette; reopen for the next iteration.
      await userEvent.click(item);
      useUIStore.setState({ commandPaletteOpen: true });
    }
  });
});

describe("CheatSheet", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<CheatSheet />);
    expect(container.firstChild).toBeNull();
  });

  it("renders shortcuts when open and closes via the close button", async () => {
    useUIStore.setState({ cheatSheetOpen: true });
    render(<CheatSheet />);
    expect(screen.getByRole("dialog", { name: /keyboard shortcuts/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /close cheat sheet/i }));
    expect(useUIStore.getState().cheatSheetOpen).toBe(false);
  });
});
