import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LabReadinessChecklist } from "@/components/lab/LabReadinessChecklist";
import { withRouter } from "./helpers";
import type { components } from "@/services/api/openapi";

type LabStatus = components["schemas"]["LabStatusResponse"];

const baseStatus: LabStatus = {
  lab_mode: true,
  acknowledgement_on_file: true,
  is_admin_2fa: true,
  ready: true,
};

describe("LabReadinessChecklist", () => {
  it("renders all server-provided checks with their statuses", async () => {
    const status: LabStatus = {
      ...baseStatus,
      ready: false,
      checks: [
        {
          id: "lab_mode_env",
          label: "LAB_MODE=true in backend env",
          status: "ok",
          fix_hint: "Set LAB_MODE=true and restart.",
        },
        {
          id: "admin_role",
          label: "Caller has admin role",
          status: "missing",
          fix_hint: "Ask an admin to grant your role.",
          fix_route: "/settings/users",
        },
        {
          id: "totp_recent",
          label: "Recent TOTP verification",
          status: "missing",
          fix_hint: "Re-verify in Settings → Account.",
          fix_route: "/settings/account",
        },
      ],
    };
    render(withRouter(<LabReadinessChecklist status={status} />));
    const items = await screen.findAllByTestId("lab-readiness-check");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveAttribute("data-check-id", "lab_mode_env");
    expect(items[0]).toHaveAttribute("data-check-status", "ok");
    expect(items[1]).toHaveAttribute("data-check-status", "missing");
  });

  it("renders fix_hint as a router link when fix_route is supplied", async () => {
    const status: LabStatus = {
      ...baseStatus,
      ready: false,
      checks: [
        {
          id: "totp_recent",
          label: "Recent TOTP verification",
          status: "missing",
          fix_hint: "Re-verify TOTP",
          fix_route: "/settings/account",
        },
      ],
    };
    render(withRouter(<LabReadinessChecklist status={status} />));
    const link = await screen.findByTestId("lab-readiness-fix-link");
    expect(link).toHaveAttribute("href", expect.stringContaining("/settings/account"));
    expect(link).toHaveTextContent("Re-verify TOTP");
  });

  it("renders fix_hint as plain text when fix_route is null", async () => {
    const status: LabStatus = {
      ...baseStatus,
      ready: false,
      checks: [
        {
          id: "lab_mode_env",
          label: "LAB_MODE=true",
          status: "missing",
          fix_hint: "Edit the env and restart",
          fix_route: null,
        },
      ],
    };
    render(withRouter(<LabReadinessChecklist status={status} />));
    expect(await screen.findByText("Edit the env and restart")).toBeInTheDocument();
    expect(screen.queryByTestId("lab-readiness-fix-link")).toBeNull();
  });

  it("uses the green styling when ready=true", async () => {
    const status: LabStatus = {
      ...baseStatus,
      ready: true,
      checks: [{ id: "lab_mode_env", label: "x", status: "ok", fix_hint: "" }],
    };
    render(withRouter(<LabReadinessChecklist status={status} />));
    const section = await screen.findByTestId("lab-readiness-checklist");
    expect(section.className).toMatch(/accent-green/);
  });

  it("falls back to the legacy three-flag list when checks is missing", async () => {
    const status: LabStatus = {
      ...baseStatus,
      ready: false,
      lab_mode: true,
      acknowledgement_on_file: false,
      is_admin_2fa: false,
    };
    render(withRouter(<LabReadinessChecklist status={status} />));
    const items = await screen.findAllByTestId("lab-readiness-check");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveAttribute("data-check-status", "ok");
    expect(items[1]).toHaveAttribute("data-check-status", "missing");
    expect(items[2]).toHaveAttribute("data-check-status", "missing");
  });
});
