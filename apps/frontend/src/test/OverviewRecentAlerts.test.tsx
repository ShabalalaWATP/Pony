import { HttpResponse, http } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverviewRecentAlerts } from "@/components/overview/OverviewRecentAlerts";
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

describe("OverviewRecentAlerts", () => {
  it("seeds from the HTTP page", async () => {
    const { node } = withQueryAndRouter(<OverviewRecentAlerts />);
    render(node);
    const list = await screen.findByTestId("overview-recent-alerts");
    expect(list).toBeInTheDocument();
    const first = fixtures.alert.related_entities?.[0];
    expect(first).toBeDefined();
    expect(list).toHaveTextContent(first!);
  });

  it("renders the empty state when no alerts exist", async () => {
    server.use(
      http.get("/api/v1/alerts", () =>
        HttpResponse.json({ items: [], total: 0, limit: 100, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<OverviewRecentAlerts />);
    render(node);
    expect(await screen.findByText(/no alerts yet/i)).toBeInTheDocument();
  });

  it("prepends a fresh alert when alerts.fire arrives on the WS", async () => {
    const client = new OperatorWebSocketClient();
    _setOperatorClientForTests(client);
    server.use(
      http.get("/api/v1/alerts", () =>
        HttpResponse.json({ items: [], total: 0, limit: 100, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<OverviewRecentAlerts />);
    render(node);
    await screen.findByText(/no alerts yet/i);

    // Mount connects the client; emit a fresh alert.
    FakeSocket.last!.open();
    FakeSocket.last!.emit({
      kind: "alerts.fire",
      alert: {
        id: "fresh-1",
        rule_id: "rule-rogue",
        severity: "critical",
        related_entities: ["dd:ee:ff:11:22:33"],
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId("overview-recent-alerts")).toHaveTextContent("dd:ee:ff:11:22:33");
    });
  });

  it("acks an alert via the per-row button", async () => {
    let ackedId = "";
    server.use(
      http.post("/api/v1/alerts/:id/ack", ({ params }) => {
        ackedId = typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { node } = withQueryAndRouter(<OverviewRecentAlerts />);
    render(node);
    await screen.findByTestId("overview-recent-alerts");
    await userEvent.click(screen.getByRole("button", { name: /^ack$/i }));
    await waitFor(() => expect(ackedId).toBe(fixtures.alert.id));
  });
});
