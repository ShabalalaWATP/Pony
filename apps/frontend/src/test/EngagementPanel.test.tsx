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
};

describe("EngagementPanel", () => {
  it("renders the engagement name + id", () => {
    const { node } = withQuery(<EngagementPanel engagement={engagement} />);
    render(node);
    expect(screen.getByText(engagement.name)).toBeInTheDocument();
    expect(screen.getByText(`id: ${engagement.id}`)).toBeInTheDocument();
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
});
