import { HttpResponse, http } from "msw";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AuditView } from "@/components/audit/AuditView";
import { filterAudit } from "@/components/audit/filters";
import { type AuditLog } from "@/services/api/queries";
import { withQueryAndRouter } from "./helpers";
import { server } from "./msw/server";

/**
 * Scope a query to the data-table region so action / outcome text
 * inside the filter chip strip doesn't collide with the same text
 * appearing in a table cell.
 */
function table(): HTMLElement {
  return screen.getByRole("region", { name: /audit entries/i });
}

const sample: AuditLog[] = [
  {
    id: "a-1",
    actor_id: "operator@cheeky.local",
    action: "lab.deauth.start",
    outcome: "denied:lab_mode_disabled",
    occurred_at: "2026-05-17T10:00:00Z",
    target: { sensor_id: "sensor-1" },
    parameters: { module: "deauth" },
  },
  {
    id: "a-2",
    actor_id: "admin@cheeky.local",
    action: "auth.login",
    outcome: "ok",
    occurred_at: "2026-05-17T10:00:01Z",
    target: {},
    parameters: {},
  },
  {
    id: "a-3",
    actor_id: "operator@cheeky.local",
    action: "alerts.rules.create",
    outcome: "ok",
    occurred_at: "2026-05-17T10:00:02Z",
    target: { rule_id: "rule-9" },
    parameters: { name: "Free SSID" },
  },
];

function useAuditServer(items: AuditLog[]): void {
  server.use(
    http.get("/api/v1/audit", () =>
      HttpResponse.json({ items, total: items.length, limit: 200, offset: 0 }),
    ),
  );
}

describe("filterAudit (pure)", () => {
  it("filters by action prefix", () => {
    expect(filterAudit(sample, "lab.deauth", undefined)).toHaveLength(1);
    expect(filterAudit(sample, "alerts.rules", undefined)).toHaveLength(1);
    expect(filterAudit(sample, "auth.login", undefined)).toHaveLength(1);
  });

  it("filters denied vs ok outcomes", () => {
    expect(filterAudit(sample, undefined, "denied")).toHaveLength(1);
    expect(filterAudit(sample, undefined, "ok")).toHaveLength(2);
  });

  it("combines action + outcome", () => {
    expect(filterAudit(sample, "lab.deauth", "ok")).toHaveLength(0);
    expect(filterAudit(sample, "lab.deauth", "denied")).toHaveLength(1);
  });

  it("returns all rows when no filters are active", () => {
    expect(filterAudit(sample, undefined, undefined)).toHaveLength(3);
  });
});

describe("AuditView", () => {
  it("renders audit rows from the backend", async () => {
    useAuditServer(sample);
    const { node } = withQueryAndRouter(<AuditView />, { initialPath: "/audit" });
    render(node);
    expect(await screen.findByText("lab.deauth.start")).toBeInTheDocument();
    // Scope to the table region — `auth.login` also appears as a
    // filter chip button up top.
    expect(within(table()).getByText("auth.login")).toBeInTheDocument();
    expect(within(table()).getByText("alerts.rules.create")).toBeInTheDocument();
    expect(within(table()).getByText("denied:lab_mode_disabled")).toBeInTheDocument();
  });

  it("shows the admin-required empty state on 403", async () => {
    server.use(
      http.get("/api/v1/audit", () =>
        HttpResponse.json({ detail: "Admin role with recent TOTP required" }, { status: 403 }),
      ),
    );
    const { node } = withQueryAndRouter(<AuditView />, { initialPath: "/audit" });
    render(node);
    expect(await screen.findByText(/audit log is restricted/i)).toBeInTheDocument();
  });

  it("narrows the table when the `denied` outcome chip is pressed", async () => {
    useAuditServer(sample);
    const { node } = withQueryAndRouter(<AuditView />, { initialPath: "/audit" });
    render(node);
    await screen.findByText("lab.deauth.start");
    await userEvent.click(screen.getByRole("button", { name: /^denied$/i, pressed: false }));
    expect(within(table()).queryByText("auth.login")).toBeNull();
    expect(within(table()).queryByText("alerts.rules.create")).toBeNull();
    expect(within(table()).getByText("lab.deauth.start")).toBeInTheDocument();
  });

  it("opens the detail drawer with target + parameters JSON when a row is clicked", async () => {
    useAuditServer(sample);
    const { node } = withQueryAndRouter(<AuditView />, { initialPath: "/audit" });
    render(node);
    const row = await screen.findByText("lab.deauth.start");
    await userEvent.click(row);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    const target = await screen.findByTestId("audit-entry-target");
    expect(target.textContent).toContain("sensor-1");
    const params = screen.getByTestId("audit-entry-parameters");
    expect(params.textContent).toContain("deauth");
  });

  it("filters by action prefix chip", async () => {
    useAuditServer(sample);
    const { node } = withQueryAndRouter(<AuditView />, { initialPath: "/audit" });
    render(node);
    await screen.findByText("lab.deauth.start");
    await userEvent.click(screen.getByRole("button", { name: /^auth\.login$/i, pressed: false }));
    expect(within(table()).queryByText("lab.deauth.start")).toBeNull();
    expect(within(table()).queryByText("alerts.rules.create")).toBeNull();
    expect(within(table()).getByText("auth.login")).toBeInTheDocument();
  });

  it("renders an empty state when nothing matches the filters", async () => {
    useAuditServer([sample[1]!]); // only the ok entry
    const { node } = withQueryAndRouter(<AuditView />, { initialPath: "/audit" });
    render(node);
    // Scope to the table to avoid the matching chip in the filter strip.
    await screen.findByRole("region", { name: /audit entries/i });
    expect(within(table()).getByText("auth.login")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^denied$/i, pressed: false }));
    expect(await screen.findByText(/no audit entries match/i)).toBeInTheDocument();
  });
});
