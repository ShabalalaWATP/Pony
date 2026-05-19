import { HttpResponse, http } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { EngagementDetailView } from "@/components/engagements/EngagementDetailView";
import { withQueryAndRouter } from "./helpers";
import { fixtures } from "./msw/handlers";
import { server } from "./msw/server";

describe("EngagementDetailView", () => {
  it("renders the engagement metadata + scope rules from the detail endpoint", async () => {
    server.use(
      http.get("/api/v1/engagements/:id", () =>
        HttpResponse.json({
          ...fixtures.engagement,
          name: "Spring 2026",
          scope_rules: [{ org: "acme" }, { net: "10.0.0.0/24" }],
        }),
      ),
      http.get("/api/v1/engagements/:id/allow-list", () =>
        HttpResponse.json({ items: [], total: 0, limit: 200, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<EngagementDetailView engagementId="eng-1" />);
    render(node);
    expect(await screen.findByTestId("engagement-detail")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Spring 2026" })).toBeInTheDocument();
    const rules = screen.getByTestId("engagement-scope-rules");
    expect(rules).toHaveTextContent(/acme/);
    expect(rules).toHaveTextContent(/10\.0\.0\.0\/24/);
  });

  it("shows the active badge and an end form for an active engagement", async () => {
    server.use(
      http.get("/api/v1/engagements/:id", () =>
        HttpResponse.json({ ...fixtures.engagement, ended_at: null }),
      ),
      http.get("/api/v1/engagements/:id/allow-list", () =>
        HttpResponse.json({ items: [], total: 0, limit: 200, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<EngagementDetailView engagementId="eng-1" />);
    render(node);
    await screen.findByTestId("engagement-detail");
    expect(screen.getByText(/^active$/i)).toBeInTheDocument();
    expect(screen.getByTestId("engagement-end-form")).toBeInTheDocument();
  });

  it("shows a Resume action for an ended engagement", async () => {
    server.use(
      http.get("/api/v1/engagements/:id", () =>
        HttpResponse.json({
          ...fixtures.engagement,
          ended_at: "2026-05-16T12:00:00Z",
        }),
      ),
      http.get("/api/v1/engagements/:id/allow-list", () =>
        HttpResponse.json({ items: [], total: 0, limit: 200, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<EngagementDetailView engagementId="eng-1" />);
    render(node);
    await screen.findByTestId("engagement-detail");
    expect(screen.getByTestId("engagement-resume-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("engagement-end-form")).toBeNull();
  });

  it("End button stays disabled until the operator types the name verbatim", async () => {
    server.use(
      http.get("/api/v1/engagements/:id", () =>
        HttpResponse.json({ ...fixtures.engagement, name: "Confirm Me" }),
      ),
      http.get("/api/v1/engagements/:id/allow-list", () =>
        HttpResponse.json({ items: [], total: 0, limit: 200, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<EngagementDetailView engagementId="eng-1" />);
    render(node);
    await screen.findByTestId("engagement-end-form");
    const submit = screen.getByRole("button", { name: /end engagement/i });
    expect(submit).toBeDisabled();
    const input = screen.getByLabelText(/engagement name to confirm/i);
    await userEvent.type(input, "Confirm M");
    expect(submit).toBeDisabled();
    await userEvent.type(input, "e");
    expect(submit).not.toBeDisabled();
  });

  it("renders the allow-list items returned from the backend", async () => {
    server.use(
      http.get("/api/v1/engagements/:id", () => HttpResponse.json(fixtures.engagement)),
      http.get("/api/v1/engagements/:id/allow-list", () =>
        HttpResponse.json({
          items: [
            { kind: "bssid", value: "aa:bb:cc:dd:ee:01" },
            { kind: "ssid", value: "TestNet" },
          ],
          total: 2,
          limit: 200,
          offset: 0,
        }),
      ),
    );
    const { node } = withQueryAndRouter(<EngagementDetailView engagementId="eng-1" />);
    render(node);
    const list = await screen.findByTestId("engagement-allow-list");
    expect(list).toHaveTextContent(/aa:bb:cc:dd:ee:01/);
    expect(list).toHaveTextContent("TestNet");
  });

  it("renders the not-found empty state on a 404", async () => {
    server.use(
      http.get("/api/v1/engagements/:id", () =>
        HttpResponse.json({ detail: "not found" }, { status: 404 }),
      ),
    );
    const { node } = withQueryAndRouter(<EngagementDetailView engagementId="eng-missing" />);
    render(node);
    expect(await screen.findByText(/engagement not found/i)).toBeInTheDocument();
  });

  it("renders the sign-in empty state on 403", async () => {
    server.use(
      http.get("/api/v1/engagements/:id", () =>
        HttpResponse.json({ detail: "forbidden" }, { status: 403 }),
      ),
    );
    const { node } = withQueryAndRouter(<EngagementDetailView engagementId="eng-1" />);
    render(node);
    expect(await screen.findByText(/sign in required/i)).toBeInTheDocument();
  });

  it("does not fetch the allow-list while the engagement query is loading", async () => {
    let allowListHits = 0;
    server.use(
      http.get("/api/v1/engagements/:id", () => HttpResponse.json(fixtures.engagement)),
      http.get("/api/v1/engagements/:id/allow-list", () => {
        allowListHits += 1;
        return HttpResponse.json({ items: [], total: 0, limit: 200, offset: 0 });
      }),
    );
    const { node } = withQueryAndRouter(<EngagementDetailView engagementId="eng-1" />);
    render(node);
    await waitFor(() => expect(allowListHits).toBeGreaterThanOrEqual(1));
  });
});
