import { HttpResponse, http } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StartLabModuleDialog } from "@/components/lab/StartLabModuleDialog";
import type { Engagement } from "@/services/api/labQueries";
import { withQuery } from "./helpers";
import { server } from "./msw/server";

const engagement: Engagement = {
  id: "eng-1",
  name: "Spring",
  scope_rules: [],
  started_at: "2026-05-17T08:00:00Z",
};

function mount(props: Partial<Parameters<typeof StartLabModuleDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onAccepted = vi.fn();
  const { node } = withQuery(
    <StartLabModuleDialog
      module="rogue-ap"
      engagement={engagement}
      onClose={onClose}
      onAccepted={onAccepted}
      {...props}
    />,
  );
  render(node);
  return { onClose, onAccepted };
}

describe("StartLabModuleDialog", () => {
  it("renders nothing when no module is selected", () => {
    const { node } = withQuery(
      <StartLabModuleDialog module={null} engagement={engagement} onClose={vi.fn()} />,
    );
    render(node);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders a 'no active engagement' message instead of the form", () => {
    const { node } = withQuery(
      <StartLabModuleDialog module="deauth" engagement={null} onClose={vi.fn()} />,
    );
    render(node);
    expect(screen.queryByTestId("start-lab-module-form")).toBeNull();
    expect(screen.getByText(/no active engagement/i)).toBeInTheDocument();
  });

  it("keeps Fire disabled until the operator types the target back", async () => {
    server.use(
      http.get("/api/v1/sensors", () =>
        HttpResponse.json({
          items: [
            {
              id: "s-1",
              name: "wlan-pi-01",
              tailnet_ip: "100.64.0.10",
              version: "0.1.0",
              capabilities: ["passive_capture", "active_modules", "rogue_ap"],
              last_seen: new Date().toISOString(),
              revoked: false,
            },
          ],
          total: 1,
          limit: 200,
          offset: 0,
        }),
      ),
    );
    mount();
    await screen.findByTestId("start-lab-module-form");
    const fire = screen.getByRole("button", { name: /^fire rogue ap$/i });
    expect(fire).toBeDisabled();

    // Wait for the sensor list to populate before selecting.
    await screen.findByRole("option", { name: /wlan-pi-01/i });
    await userEvent.selectOptions(screen.getByLabelText(/^sensor$/i), "s-1");
    await userEvent.type(screen.getByLabelText(/target bssid/i), "aa:bb:cc:dd:ee:01");
    // Still disabled — confirm hasn't been typed yet.
    expect(fire).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/type the target to confirm/i), "aa:bb:cc:dd:ee:01");
    await waitFor(() => expect(fire).not.toBeDisabled());
  });

  it("fires the module and calls onAccepted with the returned command_id", async () => {
    let bodyReceived: unknown = null;
    server.use(
      http.get("/api/v1/sensors", () =>
        HttpResponse.json({
          items: [
            {
              id: "s-1",
              name: "pi",
              tailnet_ip: "1.1.1.1",
              version: "0",
              capabilities: [],
              last_seen: new Date().toISOString(),
              revoked: false,
            },
          ],
          total: 1,
          limit: 200,
          offset: 0,
        }),
      ),
      http.post("/api/v1/lab/:module/start", async ({ request }) => {
        bodyReceived = await request.json();
        return HttpResponse.json(
          { command_id: "cmd-fresh", started_at: "2026-05-17T10:00:00Z" },
          { status: 202 },
        );
      }),
    );
    const { onAccepted, onClose } = mount();
    await screen.findByTestId("start-lab-module-form");
    await screen.findByRole("option", { name: /pi/i });
    await userEvent.selectOptions(screen.getByLabelText(/^sensor$/i), "s-1");
    await userEvent.type(screen.getByLabelText(/target bssid/i), "aa:bb:cc:dd:ee:01");
    await userEvent.type(screen.getByLabelText(/type the target to confirm/i), "aa:bb:cc:dd:ee:01");
    await userEvent.click(screen.getByRole("button", { name: /^fire rogue ap$/i }));

    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith("cmd-fresh"));
    expect(onClose).toHaveBeenCalled();
    expect(bodyReceived).toMatchObject({
      sensor_id: "s-1",
      engagement_id: "eng-1",
      target: { kind: "bssid", value: "aa:bb:cc:dd:ee:01" },
    });
  });

  it("surfaces the backend's 403 refusal reason inline", async () => {
    server.use(
      http.get("/api/v1/sensors", () =>
        HttpResponse.json({
          items: [
            {
              id: "s-1",
              name: "pi",
              tailnet_ip: "1.1.1.1",
              version: "0",
              capabilities: [],
              last_seen: new Date().toISOString(),
              revoked: false,
            },
          ],
          total: 1,
          limit: 200,
          offset: 0,
        }),
      ),
      http.post("/api/v1/lab/:module/start", () =>
        HttpResponse.json(
          { reason: "target_not_in_allowlist", detail: "Add the target to the allow-list first." },
          { status: 403 },
        ),
      ),
    );
    mount();
    await screen.findByTestId("start-lab-module-form");
    await screen.findByRole("option", { name: /pi/i });
    await userEvent.selectOptions(screen.getByLabelText(/^sensor$/i), "s-1");
    await userEvent.type(screen.getByLabelText(/target bssid/i), "aa:bb:cc:dd:ee:01");
    await userEvent.type(screen.getByLabelText(/type the target to confirm/i), "aa:bb:cc:dd:ee:01");
    await userEvent.click(screen.getByRole("button", { name: /^fire rogue ap$/i }));
    expect(await screen.findByTestId("lab-refusal")).toHaveTextContent(/target not in allowlist/i);
    expect(screen.getByTestId("lab-refusal")).toHaveTextContent(
      /add the target to the allow-list/i,
    );
  });

  it("rejects non-object parameters JSON without firing", async () => {
    let hit = false;
    server.use(
      http.get("/api/v1/sensors", () =>
        HttpResponse.json({
          items: [
            {
              id: "s-1",
              name: "pi",
              tailnet_ip: "1.1.1.1",
              version: "0",
              capabilities: [],
              last_seen: new Date().toISOString(),
              revoked: false,
            },
          ],
          total: 1,
          limit: 200,
          offset: 0,
        }),
      ),
      http.post("/api/v1/lab/:module/start", () => {
        hit = true;
        return HttpResponse.json({ command_id: "x", started_at: "2026-05-17T10:00:00Z" });
      }),
    );
    mount();
    await screen.findByTestId("start-lab-module-form");
    await screen.findByRole("option", { name: /pi/i });
    await userEvent.selectOptions(screen.getByLabelText(/^sensor$/i), "s-1");
    await userEvent.type(screen.getByLabelText(/target bssid/i), "aa:bb:cc:dd:ee:01");
    await userEvent.type(screen.getByLabelText(/type the target to confirm/i), "aa:bb:cc:dd:ee:01");
    // Type a non-object JSON value.
    await userEvent.type(screen.getByLabelText(/parameters/i), "42");
    await userEvent.click(screen.getByRole("button", { name: /^fire rogue ap$/i }));
    expect(await screen.findByText(/parameters must be a json object/i)).toBeInTheDocument();
    expect(hit).toBe(false);
  });
});
