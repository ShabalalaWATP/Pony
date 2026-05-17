import { HttpResponse, http } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SensorCommands } from "@/components/sensors/SensorCommands";
import { _setOperatorClientForTests } from "@/services/ws/hooks";
import { OperatorWebSocketClient } from "@/services/ws/operator";
import type { Sensor } from "@/services/api/queries";
import { withQueryAndRouter } from "./helpers";
import { server } from "./msw/server";

const baseSensor: Sensor = {
  id: "sensor-1",
  name: "wlan-pi-01",
  tailnet_ip: "100.64.0.10",
  version: "0.1.0",
  capabilities: ["passive_capture", "channel_control"],
  last_seen: new Date().toISOString(),
  revoked: false,
};

class FakeSocket {
  static OPEN = WebSocket.OPEN;
  readyState: number = WebSocket.CONNECTING;
  url: string;
  private listeners: Record<string, ((ev: unknown) => void)[]> = {};
  static last: FakeSocket | null = null;
  constructor(url: string) {
    this.url = url;
    FakeSocket.last = this;
  }
  addEventListener(n: string, fn: (ev: unknown) => void): void {
    (this.listeners[n] ??= []).push(fn);
  }
  removeEventListener(): void {
    // unused
  }
  send(): void {
    // unused
  }
  close(): void {
    this.readyState = WebSocket.CLOSED;
    this.fire("close", {});
  }
  fire(n: string, ev: unknown): void {
    for (const fn of this.listeners[n] ?? []) fn(ev);
  }
  emit(m: object): void {
    this.fire("message", { data: JSON.stringify(m) });
  }
  open(): void {
    this.readyState = WebSocket.OPEN;
    this.fire("open", {});
  }
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
  _setOperatorClientForTests(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
  _setOperatorClientForTests(null);
});

async function mount(sensor: Sensor): Promise<void> {
  const { node } = withQueryAndRouter(<SensorCommands sensor={sensor} />);
  render(node);
  // Wait for the router + component tree to mount before assertions.
  await screen.findByText(/lifecycle commands/i);
}

describe("SensorCommands", () => {
  it("queues a restart command and shows the accepted note with the command_id", async () => {
    let restartHit = false;
    server.use(
      http.post("/api/v1/sensors/:id/commands/restart", () => {
        restartHit = true;
        return HttpResponse.json({ command_id: "cmd-r-abcdef12" }, { status: 202 });
      }),
    );
    await mount(baseSensor);
    await userEvent.click(screen.getByRole("button", { name: /restart sensor/i }));
    await waitFor(() => expect(restartHit).toBe(true));
    expect(await screen.findByText(/restart queued/i)).toBeInTheDocument();
    expect(screen.getByText(/cmd-r-ab/i)).toBeInTheDocument();
  });

  it("queues an update command", async () => {
    let updateHit = false;
    server.use(
      http.post("/api/v1/sensors/:id/commands/update", () => {
        updateHit = true;
        return HttpResponse.json({ command_id: "cmd-u-12345678" }, { status: 202 });
      }),
    );
    await mount(baseSensor);
    await userEvent.click(screen.getByRole("button", { name: /update sensor/i }));
    await waitFor(() => expect(updateHit).toBe(true));
    expect(await screen.findByText(/update queued/i)).toBeInTheDocument();
  });

  it("sends a set-channel command with the chosen band + channel", async () => {
    let body: unknown = null;
    server.use(
      http.post("/api/v1/sensors/:id/commands/set-channel", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ command_id: "cmd-c-1" }, { status: 202 });
      }),
    );
    await mount(baseSensor);
    const channelInput = screen.getByLabelText("Channel");
    await userEvent.clear(channelInput);
    await userEvent.type(channelInput, "36");
    await userEvent.selectOptions(screen.getByLabelText("Band"), "5");
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() => expect(body).toEqual({ channel: 36, band: "5" }));
  });

  it("hides the set-channel form when the sensor lacks channel_control", async () => {
    await mount({ ...baseSensor, capabilities: ["passive_capture"] });
    expect(screen.queryByTestId("set-channel-form")).toBeNull();
    expect(screen.getByText(/does not advertise/i)).toBeInTheDocument();
  });

  it("disables every action when the sensor is revoked", async () => {
    await mount({ ...baseSensor, revoked: true });
    expect(screen.getByRole("button", { name: /restart sensor/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /update sensor/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();
  });

  it("surfaces a 403 error inline when the backend rejects (admin/2FA missing)", async () => {
    server.use(
      http.post("/api/v1/sensors/:id/commands/restart", () =>
        HttpResponse.json({ detail: "Admin + 2FA required" }, { status: 403 }),
      ),
    );
    await mount(baseSensor);
    await userEvent.click(screen.getByRole("button", { name: /restart sensor/i }));
    expect(await screen.findByText(/admin \+ 2fa required/i)).toBeInTheDocument();
  });

  it("renders a command_result row only when the WS event matches this sensor", async () => {
    const client = new OperatorWebSocketClient();
    _setOperatorClientForTests(client);
    // useLiveTopic doesn't connect on its own — kick the shared socket so
    // FakeSocket.last is populated for the emit() calls below.
    client.connect();
    FakeSocket.last!.open();
    await mount(baseSensor);

    // Mismatched sensor — ignored.
    FakeSocket.last!.emit({
      kind: "command_result",
      sensor_id: "other-sensor",
      command_id: "cmd-other-99999999",
      command: "restart",
      outcome: "ok",
      finished_at: new Date().toISOString(),
    });
    // Matching sensor — prepended.
    FakeSocket.last!.emit({
      kind: "command_result",
      sensor_id: baseSensor.id,
      command_id: "cmd-real-99999999",
      command: "set_channel",
      outcome: "ok",
      finished_at: new Date().toISOString(),
    });

    const list = await screen.findByTestId("sensor-command-feedback");
    expect(list).toHaveTextContent("set channel");
    expect(list).toHaveTextContent("cmd-real");
    expect(list).not.toHaveTextContent("cmd-other");
  });

  it("flags a failed outcome with the red badge", async () => {
    const client = new OperatorWebSocketClient();
    _setOperatorClientForTests(client);
    client.connect();
    FakeSocket.last!.open();
    await mount(baseSensor);
    FakeSocket.last!.emit({
      kind: "command_result",
      sensor_id: baseSensor.id,
      command_id: "cmd-f-12345678",
      command: "restart",
      outcome: "failed",
      finished_at: new Date().toISOString(),
    });
    const list = await screen.findByTestId("sensor-command-feedback");
    expect(list).toHaveTextContent("failed");
  });
});
