import { HttpResponse, http } from "msw";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { EventsView } from "@/components/events/EventsView";
import { withQueryAndRouter } from "./helpers";
import { server } from "./msw/server";

const sampleEvents = [
  {
    id: "e1",
    sensor_id: "wlan-pi-01",
    kind: "access_point_seen",
    payload: { ssid: "Alpha", bssid: "aa:bb:cc:dd:ee:01" },
    occurred_at: "2026-05-17T10:00:00Z",
  },
  {
    id: "e2",
    sensor_id: "wlan-pi-01",
    kind: "client_seen",
    payload: { mac: "11:22:33:44:55:66" },
    occurred_at: "2026-05-17T10:00:01Z",
  },
  {
    id: "e3",
    sensor_id: "wlan-pi-02",
    kind: "sensor_status",
    payload: { status: "healthy" },
    occurred_at: "2026-05-17T10:00:02Z",
  },
];

describe("EventsView", () => {
  it("renders all events from the backend and shows their kinds", async () => {
    server.use(
      http.get("/api/v1/events", () =>
        HttpResponse.json({ items: sampleEvents, total: 3, limit: 500, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<EventsView />);
    render(node);
    expect(await screen.findByText("Alpha (aa:bb:cc:dd:ee:01)")).toBeInTheDocument();
    expect(screen.getByText("11:22:33:44:55:66")).toBeInTheDocument();
    expect(screen.getByText("healthy")).toBeInTheDocument();
  });

  it("filters to a single kind via the chip", async () => {
    server.use(
      http.get("/api/v1/events", () =>
        HttpResponse.json({ items: sampleEvents, total: 3, limit: 500, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<EventsView />);
    render(node);
    await screen.findByText("Alpha (aa:bb:cc:dd:ee:01)");
    await userEvent.click(screen.getByRole("button", { name: /client seen/i, pressed: false }));
    expect(screen.queryByText("Alpha (aa:bb:cc:dd:ee:01)")).toBeNull();
    expect(screen.getByText("11:22:33:44:55:66")).toBeInTheDocument();
    expect(screen.queryByText("healthy")).toBeNull();
  });

  it("opens the detail drawer and shows the JSON payload", async () => {
    server.use(
      http.get("/api/v1/events", () =>
        HttpResponse.json({ items: sampleEvents, total: 3, limit: 500, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<EventsView />);
    render(node);
    const row = await screen.findByText("11:22:33:44:55:66");
    await userEvent.click(row);
    const payload = await screen.findByTestId("event-payload");
    expect(payload.textContent).toContain("11:22:33:44:55:66");
  });

  it("shows an empty state when no events are returned", async () => {
    server.use(
      http.get("/api/v1/events", () =>
        HttpResponse.json({ items: [], total: 0, limit: 500, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<EventsView />);
    render(node);
    expect(await screen.findByText(/no events recorded yet/i)).toBeInTheDocument();
  });
});
