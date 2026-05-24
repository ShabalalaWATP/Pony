import { HttpResponse, http } from "msw";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InsightsAdminView } from "@/components/settings/InsightsAdminView";
import { withQueryAndRouter } from "./helpers";
import { server } from "./msw/server";

describe("InsightsAdminView", () => {
  it("renders the admin-only empty state on 403", async () => {
    server.use(
      http.get("/api/v1/insights/usage", () =>
        HttpResponse.json({ detail: "admin_required" }, { status: 403 }),
      ),
    );
    const { node } = withQueryAndRouter(<InsightsAdminView />);
    render(node);
    expect(await screen.findByText(/admin only/i)).toBeInTheDocument();
  });

  it("renders the budget card with current spend + remaining", async () => {
    const { node } = withQueryAndRouter(<InsightsAdminView />);
    render(node);
    expect(await screen.findByTestId("llm-current-spend")).toHaveTextContent("$5.00");
    expect(screen.getByText(/15\.00 left/)).toBeInTheDocument();
  });

  it("renders the per-kind table when last_30_days has rows", async () => {
    server.use(
      http.get("/api/v1/insights/usage", () =>
        HttpResponse.json({
          budget_micro_cents: null,
          budget_remaining_micro_cents: null,
          budget_remaining_usd: "0.00",
          current_month: "2026-05",
          current_month_spend_micro_cents: 0,
          current_month_spend_usd: "0.00",
          last_30_days: [
            { kind: "alert_context", generated: 4, cached: 12 },
            { kind: "ap_description", generated: 1, cached: 5 },
          ],
          recent_audit_entries: [],
        }),
      ),
    );
    const { node } = withQueryAndRouter(<InsightsAdminView />);
    render(node);
    expect(await screen.findByTestId("llm-per-kind-table")).toBeInTheDocument();
    expect(screen.getByTestId("llm-row-alert_context")).toHaveTextContent("4");
    expect(screen.getByTestId("llm-row-ap_description")).toHaveTextContent("1");
  });

  it("enables the kill-switch button only when typed-confirm matches the intent", async () => {
    const { node } = withQueryAndRouter(<InsightsAdminView />);
    render(node);
    const submit = await screen.findByTestId("kill-switch-submit");
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId("kill-switch-confirm-input"), {
      target: { value: "DISABLE" },
    });
    await waitFor(() => {
      expect(screen.getByTestId("kill-switch-submit")).not.toBeDisabled();
    });
  });

  it("blocks the submit when typed text doesn't match the intent dropdown", async () => {
    const { node } = withQueryAndRouter(<InsightsAdminView />);
    render(node);
    await screen.findByTestId("kill-switch-submit");
    fireEvent.change(screen.getByTestId("kill-switch-intent"), { target: { value: "ENABLE" } });
    fireEvent.change(screen.getByTestId("kill-switch-confirm-input"), {
      target: { value: "DISABLE" },
    });
    expect(screen.getByTestId("kill-switch-submit")).toBeDisabled();
  });
});
