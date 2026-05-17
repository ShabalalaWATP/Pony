import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorWebSocketClient } from "@/services/ws/operator";
import { _setOperatorClientForTests } from "@/services/ws/hooks";
import { useOperatorCacheInvalidations } from "@/services/ws/invalidations";

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
    // unused
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
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
  _setOperatorClientForTests(null);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  _setOperatorClientForTests(null);
});

function wrap(qc: QueryClient): { wrapper: (p: { children: ReactNode }) => JSX.Element } {
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper };
}

describe("useOperatorCacheInvalidations", () => {
  it("invalidates access_points, devices, and sensors when their upsert topics fire", () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const client = new OperatorWebSocketClient();
    _setOperatorClientForTests(client);
    client.connect();
    FakeSocket.last!.open();

    renderHook(() => useOperatorCacheInvalidations(), { wrapper: wrap(qc).wrapper });

    act(() => {
      FakeSocket.last!.emit({ kind: "aps.upsert", ap: { bssid: "aa:bb:cc:dd:ee:01" } });
      FakeSocket.last!.emit({ kind: "devices.upsert", client: { mac: "11:22:33:44:55:66" } });
      FakeSocket.last!.emit({ kind: "sensors.update", sensor: { id: "s1" } });
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    const kinds = invalidate.mock.calls.map((c) => (c[0]?.queryKey ?? [])[0]);
    expect(kinds).toContain("access_points");
    expect(kinds).toContain("devices");
    expect(kinds).toContain("sensors");
  });

  it("coalesces bursts on the same topic into a single invalidation per window", () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const client = new OperatorWebSocketClient();
    _setOperatorClientForTests(client);
    client.connect();
    FakeSocket.last!.open();

    renderHook(() => useOperatorCacheInvalidations(), { wrapper: wrap(qc).wrapper });

    act(() => {
      for (let i = 0; i < 10; i += 1) {
        FakeSocket.last!.emit({ kind: "aps.upsert", ap: { bssid: `aa:bb:cc:dd:ee:${i}` } });
      }
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    const apsCalls = invalidate.mock.calls.filter(
      (c) => (c[0]?.queryKey ?? [])[0] === "access_points",
    );
    expect(apsCalls).toHaveLength(1);
  });

  it("ignores unrelated topics", () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const client = new OperatorWebSocketClient();
    _setOperatorClientForTests(client);
    client.connect();
    FakeSocket.last!.open();

    renderHook(() => useOperatorCacheInvalidations(), { wrapper: wrap(qc).wrapper });

    act(() => {
      FakeSocket.last!.emit({ kind: "events.append", event: { id: "e1" } });
      FakeSocket.last!.emit({ kind: "connected" });
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(invalidate).not.toHaveBeenCalled();
  });
});
