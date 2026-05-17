import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegisterSensorDrawer } from "@/components/sensors/RegisterSensorDrawer";
import { withQuery } from "./helpers";
import { fixtures } from "./msw/handlers";
import { server } from "./msw/server";

function QueryWrap({ qc, children }: { qc: QueryClient; children: ReactNode }): JSX.Element {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

async function fillRequired(): Promise<void> {
  await userEvent.type(screen.getByLabelText(/sensor id/i), "pi-attic-01");
  await userEvent.type(screen.getByLabelText(/display name/i), "Attic Pi");
  await userEvent.type(screen.getByLabelText(/tailnet ip/i), "100.64.0.12");
  await userEvent.type(screen.getByLabelText(/agent version/i), "0.1.0");
}

describe("RegisterSensorDrawer", () => {
  // jsdom doesn't ship clipboard by default; stub it so the copy button
  // is testable without secure-context juggling.
  const clipboardSpy = vi.fn().mockResolvedValue(undefined);
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardSpy },
    });
    clipboardSpy.mockClear();
  });
  afterEach(() => {
    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  it("renders nothing when closed", () => {
    const { node } = withQuery(<RegisterSensorDrawer open={false} onClose={vi.fn()} />);
    render(node);
    expect(screen.queryByTestId("register-sensor-form")).toBeNull();
  });

  it("keeps Register disabled until every required field is filled", async () => {
    const { node } = withQuery(<RegisterSensorDrawer open onClose={vi.fn()} />);
    render(node);
    const submit = await screen.findByRole("button", { name: /^register sensor$/i });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/sensor id/i), "pi-attic-01");
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/display name/i), "Attic Pi");
    await userEvent.type(screen.getByLabelText(/tailnet ip/i), "100.64.0.12");
    await userEvent.type(screen.getByLabelText(/agent version/i), "0.1.0");
    expect(submit).not.toBeDisabled();
  });

  it("POSTs the form payload and reveals the cert blocks on success", async () => {
    let receivedBody: unknown = null;
    server.use(
      http.post("/api/v1/sensors", async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(fixtures.sensorRegister);
      }),
    );
    const onRegistered = vi.fn();
    const { node } = withQuery(
      <RegisterSensorDrawer open onClose={vi.fn()} onRegistered={onRegistered} />,
    );
    render(node);
    await fillRequired();
    await userEvent.click(screen.getByRole("button", { name: /^register sensor$/i }));

    await waitFor(() => expect(onRegistered).toHaveBeenCalledTimes(1));
    expect(receivedBody).toEqual({
      id: "pi-attic-01",
      name: "Attic Pi",
      tailnet_ip: "100.64.0.12",
      version: "0.1.0",
      capabilities: ["passive_capture"],
    });
    expect(screen.getByTestId("cert-reveal")).toBeInTheDocument();
    expect(screen.getByTestId("cert-ca")).toBeInTheDocument();
    expect(screen.getByTestId("cert-client")).toBeInTheDocument();
    expect(screen.getByTestId("cert-key")).toBeInTheDocument();
  });

  it("keeps the private key masked until Reveal is clicked", async () => {
    const { node } = withQuery(<RegisterSensorDrawer open onClose={vi.fn()} />);
    render(node);
    await fillRequired();
    await userEvent.click(screen.getByRole("button", { name: /^register sensor$/i }));

    const keyBlock = await screen.findByTestId("cert-key");
    const keyTextarea = keyBlock.querySelector("textarea")!;
    expect(keyTextarea.value).toMatch(/^•+$/);
    await userEvent.click(screen.getByRole("button", { name: /^reveal$/i }));
    expect(keyTextarea.value).toContain("BEGIN PRIVATE KEY");
  });

  it("copies a PEM block to the clipboard when Copy is clicked", async () => {
    const { node } = withQuery(<RegisterSensorDrawer open onClose={vi.fn()} />);
    render(node);
    await fillRequired();
    await userEvent.click(screen.getByRole("button", { name: /^register sensor$/i }));
    await screen.findByTestId("cert-reveal");
    await userEvent.click(screen.getByRole("button", { name: /copy ca certificate/i }));
    expect(clipboardSpy).toHaveBeenCalledWith(fixtures.sensorRegister.ca_certificate_pem);
  });

  it("clears the cert payload when the drawer is closed and reopened", async () => {
    const onClose = vi.fn();
    const { node, qc } = withQuery(<RegisterSensorDrawer open onClose={onClose} />);
    const { rerender } = render(node);
    await fillRequired();
    await userEvent.click(screen.getByRole("button", { name: /^register sensor$/i }));
    await screen.findByTestId("cert-reveal");

    rerender(
      <QueryWrap qc={qc}>
        <RegisterSensorDrawer open={false} onClose={onClose} />
      </QueryWrap>,
    );
    rerender(
      <QueryWrap qc={qc}>
        <RegisterSensorDrawer open onClose={onClose} />
      </QueryWrap>,
    );
    expect(screen.queryByTestId("cert-reveal")).toBeNull();
    expect(screen.getByTestId("register-sensor-form")).toBeInTheDocument();
  });

  it("renders 403 admin/2FA copy when the backend refuses", async () => {
    server.use(
      http.post("/api/v1/sensors", () =>
        HttpResponse.json({ detail: "Admin required" }, { status: 403 }),
      ),
    );
    const { node } = withQuery(<RegisterSensorDrawer open onClose={vi.fn()} />);
    render(node);
    await fillRequired();
    await userEvent.click(screen.getByRole("button", { name: /^register sensor$/i }));
    expect(await screen.findByTestId("register-sensor-error")).toHaveTextContent(
      /admin role \+ recent totp/i,
    );
  });

  it("toggles capability checkboxes into the payload", async () => {
    // Wrap in an object so TS's closure narrowing doesn't widen the
    // captured value to `never` after the initial `null` literal —
    // `tsc -b` (CI) treats the closure write as opaque, so reading
    // `receivedBody.capabilities` directly off a `let` errors.
    const captured: { body: { capabilities?: string[] } | null } = { body: null };
    server.use(
      http.post("/api/v1/sensors", async ({ request }) => {
        captured.body = (await request.json()) as { capabilities?: string[] };
        return HttpResponse.json(fixtures.sensorRegister);
      }),
    );
    const { node } = withQuery(<RegisterSensorDrawer open onClose={vi.fn()} />);
    render(node);
    await fillRequired();
    await userEvent.click(screen.getByLabelText(/channel control/i));
    await userEvent.click(screen.getByLabelText(/^geo$/i));
    await userEvent.click(screen.getByRole("button", { name: /^register sensor$/i }));
    await waitFor(() => expect(captured.body).not.toBeNull());
    expect(captured.body?.capabilities).toEqual(["passive_capture", "channel_control", "geo"]);
  });
});
