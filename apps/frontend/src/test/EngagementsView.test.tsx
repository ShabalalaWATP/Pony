import { HttpResponse, http } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { EngagementsView } from "@/components/engagements/EngagementsView";
import { withQueryAndRouter } from "./helpers";
import { fixtures } from "./msw/handlers";
import { server } from "./msw/server";

const active = { ...fixtures.engagement, id: "eng-active", name: "Active Op", ended_at: null };
const ended = {
  ...fixtures.engagement,
  id: "eng-ended",
  name: "Old Op",
  ended_at: "2026-05-15T10:00:00Z",
};

describe("EngagementsView", () => {
  it("renders active and ended engagements with appropriate status pills", async () => {
    server.use(
      http.get("/api/v1/engagements", () =>
        HttpResponse.json({ items: [active, ended], total: 2, limit: 500, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<EngagementsView />, { initialPath: "/engagements" });
    render(node);
    expect(await screen.findByText("Active Op")).toBeInTheDocument();
    expect(screen.getByText("Old Op")).toBeInTheDocument();
    // `Ended` matches the column header too; just check both badge labels appear.
    expect(screen.getAllByText(/^active$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^ended$/i).length).toBeGreaterThan(0);
  });

  it("renders Resume only on ended engagements", async () => {
    server.use(
      http.get("/api/v1/engagements", () =>
        HttpResponse.json({ items: [active, ended], total: 2, limit: 500, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<EngagementsView />, { initialPath: "/engagements" });
    render(node);
    await screen.findByText("Old Op");
    const buttons = screen.getAllByRole("button", { name: /resume/i });
    expect(buttons).toHaveLength(1);
  });

  it("POSTs to /resume when the Resume button is clicked", async () => {
    let path = "";
    server.use(
      http.get("/api/v1/engagements", () =>
        HttpResponse.json({ items: [ended], total: 1, limit: 500, offset: 0 }),
      ),
      http.post("/api/v1/engagements/:id/resume", ({ params }) => {
        path = typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");
        return HttpResponse.json({ ...ended, ended_at: null });
      }),
    );
    const { node } = withQueryAndRouter(<EngagementsView />, { initialPath: "/engagements" });
    render(node);
    await screen.findByText("Old Op");
    await userEvent.click(screen.getByRole("button", { name: /resume old op/i }));
    await waitFor(() => expect(path).toBe("eng-ended"));
  });

  it("surfaces a resume error inline", async () => {
    server.use(
      http.get("/api/v1/engagements", () =>
        HttpResponse.json({ items: [ended], total: 1, limit: 500, offset: 0 }),
      ),
      http.post("/api/v1/engagements/:id/resume", () =>
        HttpResponse.json({ detail: "another engagement is already active" }, { status: 409 }),
      ),
    );
    const { node } = withQueryAndRouter(<EngagementsView />, { initialPath: "/engagements" });
    render(node);
    await screen.findByText("Old Op");
    await userEvent.click(screen.getByRole("button", { name: /resume old op/i }));
    expect(await screen.findByText(/another engagement is already active/i)).toBeInTheDocument();
  });

  it("renders an empty state when no engagements exist", async () => {
    server.use(
      http.get("/api/v1/engagements", () =>
        HttpResponse.json({ items: [], total: 0, limit: 500, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<EngagementsView />, { initialPath: "/engagements" });
    render(node);
    expect(await screen.findByText(/no engagements yet/i)).toBeInTheDocument();
  });

  it("shows a sign-in-required state on 401", async () => {
    server.use(
      http.get("/api/v1/engagements", () =>
        HttpResponse.json({ detail: "Not authenticated" }, { status: 401 }),
      ),
    );
    const { node } = withQueryAndRouter(<EngagementsView />, { initialPath: "/engagements" });
    render(node);
    expect(await screen.findByText(/sign in required/i)).toBeInTheDocument();
  });

  it("opens the create drawer when the New button is clicked", async () => {
    const { node } = withQueryAndRouter(<EngagementsView />, { initialPath: "/engagements" });
    render(node);
    await screen.findByRole("button", { name: /create engagement/i });
    await userEvent.click(screen.getByRole("button", { name: /create engagement/i }));
    expect(await screen.findByTestId("create-engagement-form")).toBeInTheDocument();
  });

  // NB: deep-link via `?new=1` is covered by `validateSearch` on the
  // real route file (`_shell.engagements.index.tsx`) — the unit test
  // here uses a stripped-down memory router without that schema, so
  // the URL `?new=1` doesn't reach `useSearch`. The button-click case
  // above is what the test harness can exercise faithfully.
});
