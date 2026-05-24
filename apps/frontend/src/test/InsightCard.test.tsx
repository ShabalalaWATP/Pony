import { HttpResponse, http } from "msw";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { InsightCard } from "@/components/insights/InsightCard";
import { OnDemandInsight } from "@/components/insights/OnDemandInsight";
import { withQueryAndRouter } from "./helpers";
import { server } from "./msw/server";

const goodInsight = {
  kind: "alert_context" as const,
  entity_id: "a1",
  summary: "Suspicious deauth burst from a single BSSID.",
  bullet_points: ["Check sensor coverage", "Compare against engagement allow-list"],
  confidence: "high" as const,
  generated_at: new Date().toISOString(),
  model: "gpt-4o-mini",
  template_version: "v1",
  cached: false,
};

describe("InsightCard", () => {
  it("renders the unavailable state when the backend returns 503 disabled", async () => {
    const { node } = withQueryAndRouter(<InsightCard kind="alert_context" entityId="a1" />);
    render(node);
    const unavailable = await screen.findByTestId("insight-unavailable");
    expect(unavailable).toHaveAttribute("data-reason", "disabled");
    expect(unavailable).toHaveTextContent(/disabled/i);
  });

  it("renders summary + bullets + confidence + model when the backend returns an insight", async () => {
    server.use(http.get("/api/v1/insights/alert/a1", () => HttpResponse.json(goodInsight)));
    const { node } = withQueryAndRouter(<InsightCard kind="alert_context" entityId="a1" />);
    render(node);
    expect(await screen.findByTestId("insight-summary")).toHaveTextContent(
      /suspicious deauth burst/i,
    );
    const bullets = screen.getByTestId("insight-bullets");
    expect(bullets).toHaveTextContent(/check sensor coverage/i);
    expect(bullets).toHaveTextContent(/engagement allow-list/i);
    expect(screen.getByText(/gpt-4o-mini/i)).toBeInTheDocument();
  });

  it("shows the cached flag when the insight came from the server cache", async () => {
    server.use(
      http.get("/api/v1/insights/alert/a1", () =>
        HttpResponse.json({ ...goodInsight, cached: true }),
      ),
    );
    const { node } = withQueryAndRouter(<InsightCard kind="alert_context" entityId="a1" />);
    render(node);
    expect(await screen.findByTestId("insight-cached-flag")).toBeInTheDocument();
  });

  it("distinguishes budget_exceeded from disabled in the unavailable copy", async () => {
    server.use(
      http.get("/api/v1/insights/alert/a1", () =>
        HttpResponse.json(
          { detail: "llm_unavailable", reason: "budget_exceeded" },
          { status: 503 },
        ),
      ),
    );
    const { node } = withQueryAndRouter(<InsightCard kind="alert_context" entityId="a1" />);
    render(node);
    const el = await screen.findByTestId("insight-unavailable");
    expect(el).toHaveAttribute("data-reason", "budget_exceeded");
    expect(el).toHaveTextContent(/budget/i);
  });

  it("Refresh button only renders when allowRefresh is set", async () => {
    const { node } = withQueryAndRouter(<InsightCard kind="alert_context" entityId="a1" />);
    render(node);
    await screen.findByTestId("insight-card");
    expect(screen.queryByTestId("insight-refresh-button")).toBeNull();
  });
});

describe("OnDemandInsight", () => {
  it("renders a button initially and only fetches when clicked", async () => {
    let fetched = 0;
    server.use(
      http.get("/api/v1/insights/ap/abc", () => {
        fetched += 1;
        return HttpResponse.json(goodInsight);
      }),
    );
    const { node } = withQueryAndRouter(<OnDemandInsight kind="ap_description" entityId="abc" />);
    render(node);
    expect(await screen.findByTestId("on-demand-insight-button")).toBeInTheDocument();
    expect(fetched).toBe(0);
    await userEvent.click(screen.getByTestId("on-demand-insight-button"));
    await screen.findByTestId("insight-card");
    expect(fetched).toBeGreaterThanOrEqual(1);
  });
});
