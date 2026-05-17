import { HttpResponse, http } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ReportsPanel } from "@/components/lab/ReportsPanel";
import type { Engagement } from "@/services/api/labQueries";
import { withQuery } from "./helpers";
import { server } from "./msw/server";

const engagement: Engagement = {
  id: "eng-1",
  name: "Spring",
  scope_rules: [],
  started_at: "2026-05-17T08:00:00.000Z",
};

describe("ReportsPanel", () => {
  it("renders the empty-state message before any reports are queued", () => {
    const { node } = withQuery(<ReportsPanel engagement={engagement} />);
    render(node);
    expect(screen.getByText(/no reports queued this session/i)).toBeInTheDocument();
  });

  it("shows the PCAP empty-capture warning only when PCAP is selected", async () => {
    const { node } = withQuery(<ReportsPanel engagement={engagement} />);
    render(node);
    expect(screen.queryByTestId("pcap-empty-warning")).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText(/report format/i), "pcap");
    expect(await screen.findByTestId("pcap-empty-warning")).toBeInTheDocument();
  });

  it("POSTs a report request and adds a row with the returned report_id", async () => {
    let body: unknown = null;
    server.use(
      http.post("/api/v1/engagements/:id/reports", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ report_id: "abcd1234ef", status: "pending" }, { status: 202 });
      }),
      http.get("/api/v1/engagements/:id/reports/:reportId", () =>
        HttpResponse.json({ status: "pending" }),
      ),
    );
    const { node } = withQuery(<ReportsPanel engagement={engagement} />);
    render(node);
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toMatchObject({ format: "pdf" });
    // Row appears with the truncated id.
    const row = await screen.findByTestId("report-row");
    expect(row).toHaveAttribute("data-status", "pending");
    expect(row).toHaveTextContent("abcd1234");
  });

  it("renders a download anchor pointing at download_url when status flips to ready", async () => {
    server.use(
      http.post("/api/v1/engagements/:id/reports", () =>
        HttpResponse.json({ report_id: "rdy1234567", status: "pending" }, { status: 202 }),
      ),
      http.get("/api/v1/engagements/:id/reports/:reportId", () =>
        HttpResponse.json({
          status: "ready",
          download_url: "/api/v1/engagements/eng-1/reports/rdy1234567/download?token=sig",
        }),
      ),
    );
    const { node } = withQuery(<ReportsPanel engagement={engagement} />);
    render(node);
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }));
    const link = await screen.findByRole("link", { name: /download report rdy1234567/i });
    expect(link).toHaveAttribute(
      "href",
      "/api/v1/engagements/eng-1/reports/rdy1234567/download?token=sig",
    );
    expect(link).toHaveAttribute("download");
  });

  it("surfaces the backend error string when status is failed", async () => {
    server.use(
      http.post("/api/v1/engagements/:id/reports", () =>
        HttpResponse.json({ report_id: "bad1234567", status: "pending" }, { status: 202 }),
      ),
      http.get("/api/v1/engagements/:id/reports/:reportId", () =>
        HttpResponse.json({ status: "failed", error: "engagement has no events" }),
      ),
    );
    const { node } = withQuery(<ReportsPanel engagement={engagement} />);
    render(node);
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }));
    expect(await screen.findByText(/engagement has no events/i)).toBeInTheDocument();
    const row = await screen.findByTestId("report-row");
    expect(row).toHaveAttribute("data-status", "failed");
  });

  it("disables Generate when until is not after since", async () => {
    const { node } = withQuery(<ReportsPanel engagement={engagement} />);
    render(node);
    const since = screen.getByLabelText(/report start/i);
    const until = screen.getByLabelText(/report end/i);
    await userEvent.clear(since);
    await userEvent.type(since, "2026-05-17T12:00");
    await userEvent.clear(until);
    await userEvent.type(until, "2026-05-17T10:00");
    expect(screen.getByRole("button", { name: /^generate$/i })).toBeDisabled();
  });

  it("quick-range button sets since/until to the requested window", async () => {
    const { node } = withQuery(<ReportsPanel engagement={engagement} />);
    render(node);
    const since = screen.getByLabelText<HTMLInputElement>(/report start/i);
    const until = screen.getByLabelText<HTMLInputElement>(/report end/i);
    const initialSince = since.value;
    await userEvent.click(screen.getByRole("button", { name: /last 1h/i }));
    // The exact ms will differ, but `since` should have moved up.
    expect(since.value).not.toBe(initialSince);
    expect(until.value).not.toBe("");
    // 'Since' must be strictly before 'Until' after the click.
    expect(new Date(until.value).getTime()).toBeGreaterThan(new Date(since.value).getTime());
  });
});
