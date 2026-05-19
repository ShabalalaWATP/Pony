import { HttpResponse, http } from "msw";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SystemView } from "@/components/settings/SystemView";
import { withQuery } from "./helpers";
import { server } from "./msw/server";

/**
 * Read the canonical statement off the rendered DOM so the test
 * doesn't drift when the source string changes.
 */
async function readStatement(): Promise<string> {
  const block = await screen.findByTestId("ack-statement");
  return block.textContent ?? "";
}

describe("SystemView", () => {
  it("shows the sign-in required state when /lab/status is 401", async () => {
    server.use(
      http.get("/api/v1/lab/status", () =>
        HttpResponse.json({ detail: "Not authenticated" }, { status: 401 }),
      ),
    );
    const { node } = withQuery(<SystemView />);
    render(node);
    expect(await screen.findByText(/sign in required/i)).toBeInTheDocument();
  });

  it("renders the gate card with three LeaderRows (lab_mode + ack + 2FA)", async () => {
    server.use(
      http.get("/api/v1/lab/status", () =>
        HttpResponse.json({
          lab_mode: true,
          acknowledgement_on_file: false,
          is_admin_2fa: true,
        }),
      ),
    );
    const { node } = withQuery(<SystemView />);
    render(node);
    const card = await screen.findByTestId("system-gate-card");
    const rows = within(card).getAllByTestId("leader-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(/LAB_MODE/);
    expect(rows[0]).toHaveTextContent(/OK/);
    expect(rows[1]).toHaveTextContent(/AUTHORIZED OPERATOR/);
    expect(rows[1]).toHaveTextContent(/MISSING/);
    expect(rows[2]).toHaveTextContent(/ADMIN \+ RECENT 2FA/);
    expect(rows[2]).toHaveTextContent(/OK/);
    // Hint for the only failing gate shows up.
    const hints = within(card).getAllByTestId("system-gate-hint");
    expect(hints).toHaveLength(1);
    expect(hints[0]).toHaveTextContent(/Type and accept the statement/);
  });

  it("hides the acknowledgement form when one is already on file", async () => {
    server.use(
      http.get("/api/v1/lab/status", () =>
        HttpResponse.json({
          lab_mode: true,
          acknowledgement_on_file: true,
          is_admin_2fa: true,
        }),
      ),
    );
    const { node } = withQuery(<SystemView />);
    render(node);
    expect(await screen.findByTestId("ack-on-file")).toBeInTheDocument();
    expect(screen.queryByTestId("ack-form")).toBeNull();
  });

  it("keeps Accept disabled until the operator types the statement verbatim", async () => {
    const { node } = withQuery(<SystemView />);
    render(node);
    const form = await screen.findByTestId("ack-form");
    const accept = within(form).getByRole("button", { name: /^accept$/i });
    expect(accept).toBeDisabled();
    const input = within(form).getByLabelText(/type the statement to confirm/i);
    await userEvent.type(input, "I am authorised — close enough?");
    expect(accept).toBeDisabled();
  });

  it("posts the acknowledgement when the statement matches", async () => {
    let receivedBody: unknown = null;
    server.use(
      http.post("/api/v1/system/acknowledgements", async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          kind: "authorized_operator",
          accepted_by: "operator@cheeky.local",
          accepted_at: "2026-05-17T10:00:00Z",
          statement_hash: "sha256:x",
        });
      }),
    );
    const { node } = withQuery(<SystemView />);
    render(node);
    await screen.findByTestId("ack-form");
    const statement = await readStatement();
    const input = screen.getByLabelText(/type the statement to confirm/i);
    // userEvent.type interprets `{` as a special key; use a paste here
    // so the statement (with parentheses, etc) lands verbatim.
    await userEvent.click(input);
    await userEvent.paste(statement);
    await userEvent.click(screen.getByRole("button", { name: /^accept$/i }));
    await waitFor(() => expect(receivedBody).toEqual({ statement }));
    expect(await screen.findByTestId("ack-on-file")).toBeInTheDocument();
  });

  it("surfaces a 403 with the admin/2FA copy", async () => {
    server.use(
      http.post("/api/v1/system/acknowledgements", () =>
        HttpResponse.json({ detail: "Admin role with recent TOTP required" }, { status: 403 }),
      ),
    );
    const { node } = withQuery(<SystemView />);
    render(node);
    await screen.findByTestId("ack-form");
    const statement = await readStatement();
    const input = screen.getByLabelText(/type the statement to confirm/i);
    await userEvent.click(input);
    await userEvent.paste(statement);
    await userEvent.click(screen.getByRole("button", { name: /^accept$/i }));
    expect(await screen.findByText(/admin role \+ recent totp is required/i)).toBeInTheDocument();
  });
});
