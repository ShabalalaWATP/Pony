import { HttpResponse, http } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AlertsView } from "@/components/alerts/AlertsView";
import { withQueryAndRouter } from "./helpers";
import { server } from "./msw/server";

const sample = [
  { id: "a1", rule_id: "rule-1", severity: "high", related_entities: ["aa:bb:cc:dd:ee:01"] },
  {
    id: "a2",
    rule_id: "rule-2",
    severity: "info",
    related_entities: [],
    acked_at: "2026-05-17T10:00:00Z",
    acked_by: "operator@cheeky.local",
  },
];

describe("AlertsView", () => {
  it("renders alerts from the backend with their severity + state", async () => {
    server.use(
      http.get("/api/v1/alerts", () =>
        HttpResponse.json({ items: sample, total: 2, limit: 500, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<AlertsView />, { initialPath: "/alerts" });
    render(node);
    expect(await screen.findByText("rule-1")).toBeInTheDocument();
    expect(screen.getByText("rule-2")).toBeInTheDocument();
    expect(screen.getAllByText(/^high$/i).length).toBeGreaterThan(0);
    // The lowercase "acked" badge is the row-state pill — distinct from
    // the "Acked" filter tab.
    expect(screen.getByText(/^acked$/)).toBeInTheDocument();
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
  });

  it("acks an unacked alert via the per-row button", async () => {
    let ackedId = "";
    server.use(
      http.get("/api/v1/alerts", () =>
        HttpResponse.json({ items: [sample[0]], total: 1, limit: 500, offset: 0 }),
      ),
      http.post("/api/v1/alerts/:id/ack", ({ params }) => {
        ackedId = typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { node } = withQueryAndRouter(<AlertsView />, { initialPath: "/alerts" });
    render(node);
    await screen.findByText("rule-1");
    await userEvent.click(screen.getByRole("button", { name: /acknowledge alert a1/i }));
    await waitFor(() => expect(ackedId).toBe("a1"));
  });

  it("filters severities via chip click — pressing high re-queries the backend", async () => {
    let lastSearch = "";
    server.use(
      http.get("/api/v1/alerts", ({ request }) => {
        lastSearch = new URL(request.url).search;
        return HttpResponse.json({ items: sample, total: 2, limit: 500, offset: 0 });
      }),
    );
    const { node } = withQueryAndRouter(<AlertsView />, { initialPath: "/alerts" });
    render(node);
    await screen.findByText("rule-1");
    await userEvent.click(screen.getByRole("button", { name: /^high$/i, pressed: false }));
    await waitFor(() => expect(lastSearch).toContain("severity=high"));
  });

  it("opens the detail drawer when a row is clicked", async () => {
    server.use(
      http.get("/api/v1/alerts", () =>
        HttpResponse.json({ items: [sample[0]], total: 1, limit: 500, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<AlertsView />, { initialPath: "/alerts" });
    render(node);
    const row = await screen.findByText("rule-1");
    await userEvent.click(row);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByText("aa:bb:cc:dd:ee:01").length).toBeGreaterThan(0);
  });

  it("shows an empty state when no alerts match", async () => {
    server.use(
      http.get("/api/v1/alerts", () =>
        HttpResponse.json({ items: [], total: 0, limit: 500, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<AlertsView />, { initialPath: "/alerts" });
    render(node);
    expect(await screen.findByText(/nothing to see here/i)).toBeInTheDocument();
  });
});
