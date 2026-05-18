import { HttpResponse, http } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { EngagementPanel } from "@/components/lab/EngagementPanel";
import type { Engagement } from "@/services/api/labQueries";
import { withQuery } from "./helpers";
import { server } from "./msw/server";

const engagement: Engagement = {
  id: "eng-7",
  name: "Spring Op",
  scope_rules: [],
  started_at: "2026-05-17T08:00:00Z",
  synthetic: false,
};

describe("EngagementPanel", () => {
  it("renders the engagement name + endpoint hint", () => {
    const { node } = withQuery(<EngagementPanel engagement={engagement} />);
    render(node);
    expect(screen.getByText(engagement.name)).toBeInTheDocument();
    expect(screen.getByTestId("endpoint-hint")).toHaveTextContent(
      `/api/v1/engagements/${engagement.id}`,
    );
  });

  it("POSTs to /allow-list when a target is added", async () => {
    let body: unknown = null;
    let path = "";
    server.use(
      http.post("/api/v1/engagements/:id/allow-list", async ({ params, request }) => {
        path = typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { node } = withQuery(<EngagementPanel engagement={engagement} />);
    render(node);
    await userEvent.type(screen.getByLabelText(/target value/i), "aa:bb:cc:dd:ee:01");
    await userEvent.click(screen.getByRole("button", { name: /^allow$/i }));
    await waitFor(() => expect(path).toBe("eng-7"));
    expect(body).toEqual({ kind: "bssid", value: "aa:bb:cc:dd:ee:01" });
    expect(await screen.findByText(/target added/i)).toBeInTheDocument();
  });

  it("keeps the End button disabled until the operator types the engagement name", async () => {
    const { node } = withQuery(<EngagementPanel engagement={engagement} />);
    render(node);
    const end = screen.getByRole("button", { name: /end engagement/i });
    expect(end).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/engagement name to confirm/i), "Spring Op");
    await waitFor(() => expect(end).not.toBeDisabled());
  });

  it("POSTs to /end when the confirm name matches", async () => {
    let hit = false;
    server.use(
      http.post("/api/v1/engagements/:id/end", () => {
        hit = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { node } = withQuery(<EngagementPanel engagement={engagement} />);
    render(node);
    await userEvent.type(screen.getByLabelText(/engagement name to confirm/i), "Spring Op");
    await userEvent.click(screen.getByRole("button", { name: /end engagement/i }));
    await waitFor(() => expect(hit).toBe(true));
  });

  it("surfaces an error inline when the backend rejects", async () => {
    server.use(
      http.post("/api/v1/engagements/:id/allow-list", () =>
        HttpResponse.json({ detail: "Admin required" }, { status: 403 }),
      ),
    );
    const { node } = withQuery(<EngagementPanel engagement={engagement} />);
    render(node);
    await userEvent.type(screen.getByLabelText(/target value/i), "x");
    await userEvent.click(screen.getByRole("button", { name: /^allow$/i }));
    expect(await screen.findByText(/admin required/i)).toBeInTheDocument();
  });

  it("renders the live allow-list from GET /allow-list", async () => {
    server.use(
      http.get("/api/v1/engagements/:id/allow-list", () =>
        HttpResponse.json({
          items: [
            { kind: "bssid", value: "aa:bb:cc:dd:ee:01" },
            { kind: "ssid", value: "Office-WiFi" },
          ],
          total: 2,
          limit: 200,
          offset: 0,
        }),
      ),
    );
    const { node } = withQuery(<EngagementPanel engagement={engagement} />);
    render(node);
    const list = await screen.findByTestId("allow-list");
    expect(list).toHaveTextContent("aa:bb:cc:dd:ee:01");
    expect(list).toHaveTextContent("Office-WiFi");
  });

  it("renders the empty allow-list message when the backend returns no entries", async () => {
    const { node } = withQuery(<EngagementPanel engagement={engagement} />);
    render(node);
    expect(await screen.findByText(/allow-list is empty/i)).toBeInTheDocument();
  });

  it("DELETEs the target when the remove button is clicked", async () => {
    let deleteBody: unknown = null;
    let deletePath = "";
    server.use(
      http.get("/api/v1/engagements/:id/allow-list", () =>
        HttpResponse.json({
          items: [{ kind: "bssid", value: "aa:bb:cc:dd:ee:01" }],
          total: 1,
          limit: 200,
          offset: 0,
        }),
      ),
      http.delete("/api/v1/engagements/:id/allow-list", async ({ params, request }) => {
        deletePath = typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");
        deleteBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { node } = withQuery(<EngagementPanel engagement={engagement} />);
    render(node);
    await screen.findByTestId("allow-list");
    await userEvent.click(screen.getByRole("button", { name: /remove bssid aa:bb:cc:dd:ee:01/i }));
    await waitFor(() => expect(deletePath).toBe("eng-7"));
    expect(deleteBody).toEqual({ kind: "bssid", value: "aa:bb:cc:dd:ee:01" });
  });
});
