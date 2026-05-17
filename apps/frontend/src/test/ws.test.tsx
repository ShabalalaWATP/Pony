import { renderHook, act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ConnectionState,
  OperatorWebSocketClient,
  type OperatorMessage,
} from "@/services/ws/operator";
import {
  _setOperatorClientForTests,
  useLiveTopic,
  useOperatorConnection,
} from "@/services/ws/hooks";

/**
 * Minimal WebSocket stand-in. We instance one per test so each renderer
 * gets a controllable socket without touching the real network.
 */
class FakeSocket {
  static OPEN = WebSocket.OPEN;
  readyState: number = WebSocket.CONNECTING;
  url: string;
  private listeners: Record<string, ((ev: unknown) => void)[]> = {};
  sent: string[] = [];
  static last: FakeSocket | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.last = this;
  }

  addEventListener(name: string, fn: (ev: unknown) => void): void {
    (this.listeners[name] ??= []).push(fn);
  }
  removeEventListener(): void {
    // not exercised in tests
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = WebSocket.CLOSED;
    this.fire("close", {});
  }
  fire(name: string, ev: unknown): void {
    for (const fn of this.listeners[name] ?? []) fn(ev);
  }
  emit(message: object): void {
    this.fire("message", { data: JSON.stringify(message) });
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

describe("OperatorWebSocketClient", () => {
  it("transitions idle → connecting → open and surfaces JSON messages", () => {
    const client = new OperatorWebSocketClient("/ws/operator");
    const states: ConnectionState[] = [];
    const messages: OperatorMessage[] = [];
    client.onStateChange((s) => states.push(s));
    client.subscribe((m) => messages.push(m));

    client.connect();
    expect(states).toContain("connecting");
    FakeSocket.last!.open();
    expect(client.getState()).toBe("open");

    FakeSocket.last!.emit({ kind: "connected", user_id: "u-1" });
    FakeSocket.last!.emit({ kind: "events.append", event: { id: "e1" } });
    expect(messages.length).toBe(2);
    expect(messages[0]?.kind).toBe("connected");
    expect(messages[1]?.kind).toBe("events.append");
  });

  it("ignores non-JSON and JSON without a string `kind`", () => {
    const client = new OperatorWebSocketClient();
    const messages: OperatorMessage[] = [];
    client.subscribe((m) => messages.push(m));
    client.connect();
    FakeSocket.last!.open();
    FakeSocket.last!.fire("message", { data: "not-json" });
    FakeSocket.last!.fire("message", { data: JSON.stringify({ not: "kind" }) });
    expect(messages).toEqual([]);
  });

  it("re-emits the current state to a fresh state-listener (replay)", () => {
    const client = new OperatorWebSocketClient();
    const seen: ConnectionState[] = [];
    client.onStateChange((s) => seen.push(s));
    expect(seen).toEqual(["idle"]);
  });

  it("only sends when the socket is open", () => {
    const client = new OperatorWebSocketClient();
    client.connect();
    client.send("ping");
    expect(FakeSocket.last!.sent).toEqual([]);
    FakeSocket.last!.open();
    client.send("ping");
    expect(FakeSocket.last!.sent).toEqual(["ping"]);
  });

  it("disconnect() flips to idle and stops auto-reconnect", () => {
    const client = new OperatorWebSocketClient();
    client.connect();
    FakeSocket.last!.open();
    client.disconnect();
    expect(client.getState()).toBe("idle");
  });
});

describe("useOperatorConnection / useLiveTopic", () => {
  it("connects on mount and exposes state transitions", async () => {
    const client = new OperatorWebSocketClient();
    _setOperatorClientForTests(client);
    const { result } = renderHook(() => useOperatorConnection());
    expect(result.current.state).toBe("connecting");
    act(() => {
      FakeSocket.last!.open();
    });
    await waitFor(() => expect(result.current.state).toBe("open"));
  });

  it("filters messages by topic kind", () => {
    const client = new OperatorWebSocketClient();
    _setOperatorClientForTests(client);
    client.connect();
    FakeSocket.last!.open();
    const handler = vi.fn();
    renderHook(() => useLiveTopic("events.append", handler));
    act(() => {
      FakeSocket.last!.emit({ kind: "connected" });
      FakeSocket.last!.emit({ kind: "events.append", id: "x" });
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: "events.append" }));
  });
});
