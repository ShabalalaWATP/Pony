import { HttpResponse, http } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MapView } from "@/components/map/MapView";
import { withQueryAndRouter } from "./helpers";
import { useMapPinsStore } from "@/stores/useMapPinsStore";
import { server } from "./msw/server";

// `MapCanvas` is dynamically imported and pulls in MapLibre. It expects
// a real WebGL context and DOM measurements that jsdom doesn't supply,
// so we stub the lazy-loaded module wholesale for tests.
vi.mock("@/components/map/MapCanvas", () => ({
  MapCanvas: ({ pins }: { pins: Record<string, unknown> }) => (
    <div data-testid="map-canvas-stub">{Object.keys(pins).length} pins</div>
  ),
}));

const sampleAps = [
  {
    bssid: "aa:bb:cc:dd:ee:01",
    ssid: "Alpha",
    channel: 6,
    band: "2.4",
    encryption: ["WPA2"],
    signal_history: [],
    vendor_oui: "Apple",
  },
  {
    bssid: "aa:bb:cc:dd:ee:02",
    ssid: "Bravo",
    channel: 11,
    band: "2.4",
    encryption: ["WPA3"],
    signal_history: [],
    vendor_oui: "Samsung",
  },
];

describe("MapView", () => {
  it("lists the access points in the sidebar", async () => {
    useMapPinsStore.setState({ pins: {} });
    server.use(
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({ items: sampleAps, total: 2, limit: 500, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<MapView />);
    render(node);
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
  });

  it("flips into placement mode when an AP row is clicked", async () => {
    useMapPinsStore.setState({ pins: {} });
    server.use(
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({ items: sampleAps, total: 2, limit: 500, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<MapView />);
    render(node);
    const row = await screen.findByText("Alpha");
    await userEvent.click(row);
    expect(
      await screen.findByText(/click on the map to place a pin for alpha/i),
    ).toBeInTheDocument();
  });

  it("renders an empty state when no APs exist", async () => {
    useMapPinsStore.setState({ pins: {} });
    server.use(
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({ items: [], total: 0, limit: 500, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<MapView />);
    render(node);
    expect(await screen.findByText(/no access points to place yet/i)).toBeInTheDocument();
  });

  it("badges APs that already have a pin", async () => {
    useMapPinsStore.setState({ pins: { "aa:bb:cc:dd:ee:01": { lat: 51.5, lng: -0.1 } } });
    server.use(
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({ items: sampleAps, total: 2, limit: 500, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<MapView />);
    render(node);
    await screen.findByText("Alpha");
    await waitFor(() => {
      expect(screen.getAllByText(/placed/i).length).toBeGreaterThan(0);
    });
  });
});
