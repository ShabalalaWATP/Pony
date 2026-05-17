import { HttpResponse, http } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveLabCommandsList } from "@/components/lab/ActiveLabCommandsList";
import { _setOperatorClientForTests } from "@/services/ws/hooks";
import { OperatorWebSocketClient } from "@/services/ws/operator";
import { withQueryAndRouter } from "./helpers";
import { fixtures } from "./msw/handlers";
import { server } from "./msw/server";

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

describe("ActiveLabCommandsList", () => {
  it("renders the empty state when no commands are running", async () => {
    const { node } = withQueryAndRouter(<ActiveLabCommandsList />);
    render(node);
    expect(await screen.findByText(/no active commands/i)).toBeInTheDocument();
  });

  it("renders a row for each running command with module + target", async () => {
    server.use(
      http.get("/api/v1/lab/active", () =>
        HttpResponse.json({ items: [fixtures.labActiveCommand], total: 1, limit: 100, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<ActiveLabCommandsList />);
    render(node);
    const list = await screen.findByTestId("active-lab-commands");
    expect(list).toHaveTextContent(fixtures.labActiveCommand.target.value);
    expect(list).toHaveTextContent("rogue-ap");
  });

  it("stops a command via POST /lab/{module}/stop/{command_id}", async () => {
    let module = "";
    let cid = "";
    server.use(
      http.get("/api/v1/lab/active", () =>
        HttpResponse.json({ items: [fixtures.labActiveCommand], total: 1, limit: 100, offset: 0 }),
      ),
      http.post("/api/v1/lab/:module/stop/:commandId", ({ params }) => {
        module = typeof params.module === "string" ? params.module : (params.module?.[0] ?? "");
        cid =
          typeof params.commandId === "string" ? params.commandId : (params.commandId?.[0] ?? "");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { node } = withQueryAndRouter(<ActiveLabCommandsList />);
    render(node);
    await screen.findByTestId("active-lab-commands");
    await userEvent.click(screen.getByRole("button", { name: /stop rogue-ap lab-cmd-1/i }));
    await waitFor(() => expect(module).toBe("rogue-ap"));
    expect(cid).toBe("lab-cmd-1");
  });

  it("updates the row when a lab.progress event arrives for that command_id", async () => {
    const client = new OperatorWebSocketClient();
    _setOperatorClientForTests(client);
    client.connect();
    FakeSocket.last!.open();
    server.use(
      http.get("/api/v1/lab/active", () =>
        HttpResponse.json({ items: [fixtures.labActiveCommand], total: 1, limit: 100, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<ActiveLabCommandsList />);
    render(node);
    await screen.findByTestId("active-lab-commands");
    FakeSocket.last!.emit({
      kind: "lab.progress",
      command_id: fixtures.labActiveCommand.command_id,
      status: "scanning",
      message: "12 frames",
    });
    const list = await screen.findByTestId("active-lab-commands");
    await waitFor(() => expect(list).toHaveTextContent(/scanning/i));
    expect(list).toHaveTextContent(/12 frames/);
  });

  it("ignores lab.progress events with no command_id", async () => {
    const client = new OperatorWebSocketClient();
    _setOperatorClientForTests(client);
    client.connect();
    FakeSocket.last!.open();
    server.use(
      http.get("/api/v1/lab/active", () =>
        HttpResponse.json({ items: [fixtures.labActiveCommand], total: 1, limit: 100, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<ActiveLabCommandsList />);
    render(node);
    await screen.findByTestId("active-lab-commands");
    FakeSocket.last!.emit({ kind: "lab.progress", status: "x" });
    // No progress text should appear.
    expect(screen.queryByText(/^progress$/i)).toBeNull();
  });
});
