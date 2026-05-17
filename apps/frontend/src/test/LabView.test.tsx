import { HttpResponse, http } from "msw";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LabView } from "@/components/lab/LabView";
import { withQueryAndRouter } from "./helpers";
import { fixtures } from "./msw/handlers";
import { server } from "./msw/server";

describe("LabView", () => {
  it("shows the no-engagement banner when /engagements/active 404s", async () => {
    const { node } = withQueryAndRouter(<LabView />, { initialPath: "/lab" });
    render(node);
    expect(await screen.findByText(/no active engagement/i)).toBeInTheDocument();
    // Module cards are still rendered, but disabled.
    const card = screen.getByTestId("module-card-rogue-ap");
    const btn = card.querySelector("button");
    expect(btn).toBeDisabled();
  });

  it("renders the engagement panel + active commands when an engagement is live", async () => {
    server.use(
      http.get("/api/v1/engagements/active", () => HttpResponse.json(fixtures.engagement)),
      http.get("/api/v1/lab/active", () =>
        HttpResponse.json({
          items: [fixtures.labActiveCommand],
          total: 1,
          limit: 100,
          offset: 0,
        }),
      ),
    );
    const { node } = withQueryAndRouter(<LabView />, { initialPath: "/lab" });
    render(node);
    expect(await screen.findByTestId("engagement-panel")).toHaveTextContent(
      fixtures.engagement.name,
    );
    expect(await screen.findByTestId("active-lab-commands")).toHaveTextContent(
      fixtures.labActiveCommand.target.value,
    );
  });

  it("opens the start dialog when a module card's Configure button is clicked", async () => {
    server.use(
      http.get("/api/v1/engagements/active", () => HttpResponse.json(fixtures.engagement)),
    );
    const { node } = withQueryAndRouter(<LabView />, { initialPath: "/lab" });
    render(node);
    await screen.findByTestId("engagement-panel");
    await userEvent.click(screen.getByRole("button", { name: /configure deauth/i }));
    expect(await screen.findByTestId("start-lab-module-form")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent(/fire/i);
  });

  it("disables Configure buttons when no engagement is active", async () => {
    const { node } = withQueryAndRouter(<LabView />, { initialPath: "/lab" });
    render(node);
    await screen.findByText(/no active engagement/i);
    for (const id of ["rogue-ap", "deauth", "evil-twin", "captive-portal", "mitm"]) {
      const card = screen.getByTestId(`module-card-${id}`);
      expect(card.querySelector("button")).toBeDisabled();
    }
  });

  it("renders an empty state on the active commands list when no commands are running", async () => {
    server.use(
      http.get("/api/v1/engagements/active", () => HttpResponse.json(fixtures.engagement)),
      http.get("/api/v1/lab/active", () =>
        HttpResponse.json({ items: [], total: 0, limit: 100, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<LabView />, { initialPath: "/lab" });
    render(node);
    await screen.findByTestId("engagement-panel");
    expect(await screen.findByText(/no active commands/i)).toBeInTheDocument();
  });

  it("auto-opens the dialog when ?module= is in the URL", async () => {
    server.use(
      http.get("/api/v1/engagements/active", () => HttpResponse.json(fixtures.engagement)),
    );
    const { node } = withQueryAndRouter(<LabView />, { initialPath: "/lab?module=mitm" });
    render(node);
    expect(await screen.findByTestId("start-lab-module-form")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent(/mitm/i);
  });

  it("ignores unknown module values in the URL", async () => {
    server.use(
      http.get("/api/v1/engagements/active", () => HttpResponse.json(fixtures.engagement)),
    );
    const { node } = withQueryAndRouter(<LabView />, {
      initialPath: "/lab?module=not-a-module",
    });
    render(node);
    await screen.findByTestId("engagement-panel");
    expect(screen.queryByTestId("start-lab-module-form")).toBeNull();
  });
});
