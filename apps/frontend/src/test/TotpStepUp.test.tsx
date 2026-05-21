import { HttpResponse, http } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TotpStepUp } from "@/components/auth/TotpStepUp";
import { withQuery } from "./helpers";
import { server } from "./msw/server";

/**
 * Type a 6-digit TOTP code into the `TotpInput`. `userEvent.type` won't
 * jump between the digit cells, so we focus the first cell and type
 * each digit one at a time — the input handles auto-advancement.
 */
async function typeCode(code: string): Promise<void> {
  const cells = screen.getAllByLabelText(/digit \d+/i);
  const first = cells[0];
  if (!first) throw new Error("TOTP cells not rendered");
  first.focus();
  await userEvent.keyboard(code);
}

describe("TotpStepUp", () => {
  it("renders the default copy and a 6-digit input", () => {
    const { node } = withQuery(<TotpStepUp onSuccess={() => undefined} />);
    render(node);
    expect(screen.getByText(/recent verification required/i)).toBeInTheDocument();
    expect(
      screen.getByText(/enter your current authenticator code to continue/i),
    ).toBeInTheDocument();
    expect(screen.getAllByLabelText(/digit \d+/i)).toHaveLength(6);
  });

  it("accepts custom title + description from props", () => {
    const { node } = withQuery(
      <TotpStepUp
        title="Re-verify to manage sensors"
        description="Type your current code to refresh the gate."
        onSuccess={() => undefined}
      />,
    );
    render(node);
    expect(screen.getByText(/re-verify to manage sensors/i)).toBeInTheDocument();
    expect(screen.getByText(/refresh the gate/i)).toBeInTheDocument();
  });

  it("calls onSuccess after the backend verifies the typed code", async () => {
    const onSuccess = vi.fn();
    const { node } = withQuery(<TotpStepUp onSuccess={onSuccess} />);
    render(node);
    await typeCode("123456");
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText(/verified — continuing/i)).toBeInTheDocument();
  });

  it("surfaces the backend error inline on an invalid code (no leaked status)", async () => {
    const onSuccess = vi.fn();
    server.use(
      http.post("/api/v1/auth/2fa/verify", () =>
        HttpResponse.json({ detail: "Invalid code" }, { status: 401 }),
      ),
    );
    const { node } = withQuery(<TotpStepUp onSuccess={onSuccess} />);
    render(node);
    await typeCode("000000");
    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid code/i);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("renders a cancel affordance only when onCancel is provided", () => {
    const onCancel = vi.fn();
    const { node } = withQuery(<TotpStepUp onSuccess={() => undefined} onCancel={onCancel} />);
    render(node);
    // X icon button + footer Cancel button — at least one visible.
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();

    const { node: noCancelNode } = withQuery(<TotpStepUp onSuccess={() => undefined} />);
    render(noCancelNode);
    // Only the implicit one from the first render remains; the second
    // render adds no new Cancel button.
    expect(screen.getAllByRole("button", { name: /^cancel$/i })).toHaveLength(1);
  });

  it("fires onCancel when the cancel button is clicked", async () => {
    const onCancel = vi.fn();
    const { node } = withQuery(<TotpStepUp onSuccess={() => undefined} onCancel={onCancel} />);
    render(node);
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
