import { HttpResponse, http } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CreateEngagementDrawer } from "@/components/engagements/CreateEngagementDrawer";
import { collectScopeRules } from "@/components/engagements/createHelpers";
import { withQuery } from "./helpers";
import { fixtures } from "./msw/handlers";
import { server } from "./msw/server";

describe("collectScopeRules (pure)", () => {
  it("drops blank rows and collapses each into a single-key object", () => {
    expect(
      collectScopeRules([
        { rowKey: "a", field: "org", value: "acme" },
        { rowKey: "b", field: "", value: "leftover" },
        { rowKey: "c", field: "site", value: "" },
        { rowKey: "d", field: "  net  ", value: "  10.0.0.0/24  " },
      ]),
    ).toEqual([{ org: "acme" }, { net: "10.0.0.0/24" }]);
  });

  it("returns undefined (not an empty array) when nothing valid was entered", () => {
    expect(collectScopeRules([])).toBeUndefined();
    expect(collectScopeRules([{ rowKey: "a", field: "  ", value: "  " }])).toBeUndefined();
  });
});

describe("CreateEngagementDrawer", () => {
  it("renders nothing when closed", () => {
    const { node } = withQuery(<CreateEngagementDrawer open={false} onClose={vi.fn()} />);
    render(node);
    expect(screen.queryByTestId("create-engagement-form")).toBeNull();
  });

  it("keeps Create disabled until a name is entered", async () => {
    const { node } = withQuery(<CreateEngagementDrawer open onClose={vi.fn()} />);
    render(node);
    const submit = await screen.findByRole("button", { name: /^create engagement$/i });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/name/i), "Spring");
    expect(submit).not.toBeDisabled();
  });

  it("POSTs name + scope rules and calls onCreated on success", async () => {
    let receivedBody: unknown = null;
    server.use(
      http.post("/api/v1/engagements", async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ ...fixtures.engagement, id: "eng-fresh" });
      }),
    );
    const onCreated = vi.fn();
    const onClose = vi.fn();
    const { node } = withQuery(
      <CreateEngagementDrawer open onClose={onClose} onCreated={onCreated} />,
    );
    render(node);
    await userEvent.type(screen.getByLabelText(/name/i), "Spring 2026");
    await userEvent.click(screen.getByRole("button", { name: /add rule/i }));
    await userEvent.type(screen.getByLabelText(/scope rule field/i), "org");
    await userEvent.type(screen.getByLabelText(/scope rule value/i), "acme");
    await userEvent.click(screen.getByRole("button", { name: /^create engagement$/i }));
    await waitFor(() =>
      expect(receivedBody).toEqual({ name: "Spring 2026", scope_rules: [{ org: "acme" }] }),
    );
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders 403 admin/2FA copy when the backend refuses", async () => {
    server.use(
      http.post("/api/v1/engagements", () =>
        HttpResponse.json({ detail: "Admin required" }, { status: 403 }),
      ),
    );
    const { node } = withQuery(<CreateEngagementDrawer open onClose={vi.fn()} />);
    render(node);
    await userEvent.type(screen.getByLabelText(/name/i), "Blocked");
    await userEvent.click(screen.getByRole("button", { name: /^create engagement$/i }));
    expect(await screen.findByTestId("create-engagement-error")).toHaveTextContent(
      /admin role \+ recent totp/i,
    );
  });

  it("strips empty scope rows from the payload", async () => {
    let receivedBody: unknown = null;
    server.use(
      http.post("/api/v1/engagements", async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(fixtures.engagement);
      }),
    );
    const { node } = withQuery(<CreateEngagementDrawer open onClose={vi.fn()} />);
    render(node);
    await userEvent.type(screen.getByLabelText(/name/i), "Spring");
    await userEvent.click(screen.getByRole("button", { name: /add rule/i }));
    // Leave the row blank.
    await userEvent.click(screen.getByRole("button", { name: /^create engagement$/i }));
    await waitFor(() => expect(receivedBody).toEqual({ name: "Spring" }));
  });

  it("removes a scope rule when the trash icon is clicked", async () => {
    const { node } = withQuery(<CreateEngagementDrawer open onClose={vi.fn()} />);
    render(node);
    await userEvent.click(screen.getByRole("button", { name: /add rule/i }));
    expect(screen.getByTestId("scope-rules")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /remove scope rule/i }));
    expect(screen.queryByTestId("scope-rules")).toBeNull();
  });
});
