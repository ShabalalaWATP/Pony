import { HttpResponse, http } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlertRulesView } from "@/components/alerts/AlertRulesView";
import { withQueryAndRouter } from "./helpers";
import { fixtures } from "./msw/handlers";
import { server } from "./msw/server";

const sampleRules = [
  fixtures.alertRule,
  {
    id: "rule-2",
    name: "High-power probe burst",
    description: null,
    severity: "medium",
    enabled: false,
    predicate: { event_kind: "client_seen" },
    created_by: "operator@cheeky.local",
    created_at: "2026-05-17T08:30:00Z",
  },
];

beforeEach(() => {
  // Allow component to use window.confirm in the deletion path.
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("AlertRulesView", () => {
  it("shows the admin-required empty state when the list 403s", async () => {
    // Default msw handler returns 403.
    const { node } = withQueryAndRouter(<AlertRulesView />, { initialPath: "/alerts/rules" });
    render(node);
    expect(await screen.findByText(/admin \+ 2fa required/i)).toBeInTheDocument();
  });

  it("renders the rule list when authorized", async () => {
    server.use(
      http.get("/api/v1/alerts/rules", () =>
        HttpResponse.json({ items: sampleRules, total: 2, limit: 500, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<AlertRulesView />, { initialPath: "/alerts/rules" });
    render(node);
    expect(await screen.findByText("Free WiFi rogue SSID")).toBeInTheDocument();
    expect(screen.getByText("High-power probe burst")).toBeInTheDocument();
    // Enabled / disabled badge.
    expect(screen.getByText(/^on$/i)).toBeInTheDocument();
    expect(screen.getByText(/^off$/i)).toBeInTheDocument();
  });

  it("creates a new rule via the drawer form", async () => {
    let createBody: unknown = null;
    server.use(
      http.get("/api/v1/alerts/rules", () =>
        HttpResponse.json({ items: [], total: 0, limit: 500, offset: 0 }),
      ),
      http.post("/api/v1/alerts/rules", async ({ request }) => {
        createBody = await request.json();
        return HttpResponse.json(fixtures.alertRule);
      }),
    );
    const { node } = withQueryAndRouter(<AlertRulesView />, { initialPath: "/alerts/rules" });
    render(node);
    await screen.findByText(/no alert rules yet/i);
    await userEvent.click(screen.getByRole("button", { name: /new rule/i }));
    await screen.findByTestId("alert-rule-form");
    await userEvent.type(screen.getByLabelText(/^name$/i), "Watch known clients");
    await userEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => expect(createBody).not.toBeNull());
    expect(createBody).toMatchObject({ name: "Watch known clients", enabled: true });
  });

  it("rejects a non-JSON predicate without firing the mutation", async () => {
    server.use(
      http.get("/api/v1/alerts/rules", () =>
        HttpResponse.json({ items: [], total: 0, limit: 500, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<AlertRulesView />, { initialPath: "/alerts/rules" });
    render(node);
    await userEvent.click(await screen.findByRole("button", { name: /new rule/i }));
    const predicate = await screen.findByLabelText(/predicate/i);
    await userEvent.clear(predicate);
    await userEvent.type(predicate, "not-json");
    await userEvent.type(screen.getByLabelText(/^name$/i), "Bad");
    await userEvent.click(screen.getByRole("button", { name: /^create$/i }));
    expect(await screen.findByText(/predicate is not valid json/i)).toBeInTheDocument();
  });

  it("deletes a rule after confirm()", async () => {
    let deletedId = "";
    server.use(
      http.get("/api/v1/alerts/rules", () =>
        HttpResponse.json({ items: sampleRules, total: 2, limit: 500, offset: 0 }),
      ),
      http.delete("/api/v1/alerts/rules/:id", ({ params }) => {
        deletedId = typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { node } = withQueryAndRouter(<AlertRulesView />, { initialPath: "/alerts/rules" });
    render(node);
    await screen.findByText("Free WiFi rogue SSID");
    await userEvent.click(screen.getByRole("button", { name: /delete free wifi rogue ssid/i }));
    await waitFor(() => expect(deletedId).toBe("rule-1"));
  });

  it("does NOT delete when confirm() is dismissed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    let hit = false;
    server.use(
      http.get("/api/v1/alerts/rules", () =>
        HttpResponse.json({ items: sampleRules, total: 2, limit: 500, offset: 0 }),
      ),
      http.delete("/api/v1/alerts/rules/:id", () => {
        hit = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { node } = withQueryAndRouter(<AlertRulesView />, { initialPath: "/alerts/rules" });
    render(node);
    await screen.findByText("Free WiFi rogue SSID");
    await userEvent.click(screen.getByRole("button", { name: /delete free wifi rogue ssid/i }));
    // Yield a microtask for any pending mutation start.
    await new Promise((r) => setTimeout(r, 0));
    expect(hit).toBe(false);
  });
});
