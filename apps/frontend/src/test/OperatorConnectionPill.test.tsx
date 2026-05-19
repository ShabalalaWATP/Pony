import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorConnectionPill } from "@/components/layout/OperatorConnectionPill";
import { _setOperatorClientForTests } from "@/services/ws/hooks";
import { OperatorWebSocketClient } from "@/services/ws/operator";

class FakeSocket {
  static OPEN = WebSocket.OPEN;
  static last: FakeSocket | null = null;
  readyState: number = WebSocket.CONNECTING;
  url: string;
  private listeners: Record<string, ((ev: unknown) => void)[]> = {};

  constructor(url: string) {
    this.url = url;
    FakeSocket.last = this;
  }
  addEventListener(name: string, fn: (ev: unknown) => void): void {
    (this.listeners[name] ??= []).push(fn);
  }
  removeEventListener(): void {
    /* not used */
  }
  send(): void {
    /* not used */
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

describe("OperatorConnectionPill", () => {
  it("renders offline before the socket opens", () => {
    const client = new OperatorWebSocketClient();
    _setOperatorClientForTests(client);
    render(<OperatorConnectionPill />);
    const pill = screen.getByTestId("operator-connection-pill");
    expect(pill).toHaveAttribute("data-state", "offline");
  });

  it("flips to live when a message arrives", async () => {
    const client = new OperatorWebSocketClient();
    _setOperatorClientForTests(client);
    render(<OperatorConnectionPill />);
    act(() => {
      FakeSocket.last!.open();
      FakeSocket.last!.emit({ kind: "events.append", id: "e1" });
    });
    await waitFor(() => {
      expect(screen.getByTestId("operator-connection-pill")).toHaveAttribute("data-state", "live");
    });
  });

  it("collapses live → stale once no message arrives within the fresh window", () => {
    vi.useFakeTimers();
    try {
      const client = new OperatorWebSocketClient();
      _setOperatorClientForTests(client);
      render(<OperatorConnectionPill />);
      act(() => {
        FakeSocket.last!.open();
        FakeSocket.last!.emit({ kind: "events.append", id: "e1" });
      });
      // Advance past 5s (fresh window) but stay under 60s (idle window).
      act(() => {
        vi.advanceTimersByTime(7_000);
      });
      const pill = screen.getByTestId("operator-connection-pill");
      expect(pill).toHaveAttribute("data-state", "stale");
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns to offline when no message arrives within the idle window", () => {
    vi.useFakeTimers();
    try {
      const client = new OperatorWebSocketClient();
      _setOperatorClientForTests(client);
      render(<OperatorConnectionPill />);
      act(() => {
        FakeSocket.last!.open();
        FakeSocket.last!.emit({ kind: "events.append", id: "e1" });
      });
      // Past the 60s idle threshold.
      act(() => {
        vi.advanceTimersByTime(75_000);
      });
      const pill = screen.getByTestId("operator-connection-pill");
      expect(pill).toHaveAttribute("data-state", "offline");
    } finally {
      vi.useRealTimers();
    }
  });
});
