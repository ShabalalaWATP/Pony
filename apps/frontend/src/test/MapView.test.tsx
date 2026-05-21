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

  it("merges server-side AP coordinates with manual pins, server-side counted separately", async () => {
    useMapPinsStore.setState({ pins: {} });
    server.use(
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({
          items: [
            {
              bssid: "aa:bb:cc:dd:ee:01",
              ssid: "Alpha",
              channel: 6,
              signal_history: [],
              latitude: 51.5,
              longitude: -0.1,
              location_source: "sensor_gps",
            },
            { bssid: "aa:bb:cc:dd:ee:02", ssid: "Bravo", channel: 11, signal_history: [] },
          ],
          total: 2,
          limit: 500,
          offset: 0,
        }),
      ),
    );
    const { node } = withQueryAndRouter(<MapView />);
    render(node);
    await screen.findByText("Alpha");
    // Map canvas stub gets one merged pin (Alpha's server coords).
    expect(await screen.findByText(/1 pins/)).toBeInTheDocument();
    // Page header surfaces the server-located count.
    expect(await screen.findByText(/from sensors/i)).toBeInTheDocument();
  });

  it("surfaces a no-GPS hint when APs exist but none carry geo coords", async () => {
    useMapPinsStore.setState({ pins: {} });
    server.use(
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({ items: sampleAps, total: 2, limit: 500, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<MapView />);
    render(node);
    expect(await screen.findByTestId("map-no-geo-hint")).toBeInTheDocument();
    expect(screen.getByText(/no gps coordinates on these access points yet/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /scatter 2 unplaced access points as demo pins/i }),
    ).toBeInTheDocument();
  });

  it("hides the no-GPS hint as soon as one server-side coord shows up", async () => {
    useMapPinsStore.setState({ pins: {} });
    server.use(
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({
          items: [
            {
              bssid: "aa:bb:cc:dd:ee:01",
              ssid: "Alpha",
              channel: 6,
              signal_history: [],
              latitude: 51.5,
              longitude: -0.1,
              location_source: "sensor_gps",
            },
            { bssid: "aa:bb:cc:dd:ee:02", ssid: "Bravo", channel: 11, signal_history: [] },
          ],
          total: 2,
          limit: 500,
          offset: 0,
        }),
      ),
    );
    const { node } = withQueryAndRouter(<MapView />);
    render(node);
    await screen.findByText("Alpha");
    expect(screen.queryByTestId("map-no-geo-hint")).toBeNull();
  });

  it("scatters demo pins for every unplaced AP when the button is clicked", async () => {
    useMapPinsStore.setState({ pins: {} });
    server.use(
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({ items: sampleAps, total: 2, limit: 500, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<MapView />);
    render(node);
    await screen.findByTestId("map-no-geo-hint");
    await userEvent.click(screen.getByTestId("map-scatter-demo-pins"));
    // Both APs now have manual pins; the merged-pins map reaches the
    // canvas stub as "2 pins".
    expect(await screen.findByText(/2 pins/)).toBeInTheDocument();
    // The hint disappears once manual pins exist for every unplaced AP.
    expect(screen.queryByTestId("map-no-geo-hint")).toBeNull();
    // Pins persisted in the Zustand store, lowercased.
    const stored = useMapPinsStore.getState().pins;
    expect(Object.keys(stored)).toEqual(
      expect.arrayContaining(["aa:bb:cc:dd:ee:01", "aa:bb:cc:dd:ee:02"]),
    );
  });

  it("scattering is deterministic — repeat clicks land at the same coords", async () => {
    useMapPinsStore.setState({ pins: {} });
    server.use(
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({ items: sampleAps, total: 2, limit: 500, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<MapView />);
    render(node);
    await userEvent.click(await screen.findByTestId("map-scatter-demo-pins"));
    const first = { ...useMapPinsStore.getState().pins };
    // Clear manually then re-scatter — the hash-derived coords should match.
    useMapPinsStore.getState().clear();
    // Re-render is implicit; the no-geo hint comes back, scatter again.
    await screen.findByTestId("map-no-geo-hint");
    await userEvent.click(screen.getByTestId("map-scatter-demo-pins"));
    expect(useMapPinsStore.getState().pins).toEqual(first);
  });

  it("operator pin overrides server coords for the same BSSID", async () => {
    useMapPinsStore.setState({
      pins: { "aa:bb:cc:dd:ee:01": { lat: 0, lng: 0 } },
    });
    server.use(
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({
          items: [
            {
              bssid: "aa:bb:cc:dd:ee:01",
              ssid: "Alpha",
              channel: 6,
              signal_history: [],
              latitude: 51.5,
              longitude: -0.1,
              location_source: "sensor_gps",
            },
          ],
          total: 1,
          limit: 500,
          offset: 0,
        }),
      ),
    );
    const { node } = withQueryAndRouter(<MapView />);
    render(node);
    await screen.findByText("Alpha");
    // Override count visible in the page header.
    expect(await screen.findByText(/1 manual/i)).toBeInTheDocument();
    // …and "from sensors" badge is NOT shown (server count drops to 0).
    expect(screen.queryByText(/from sensors/i)).toBeNull();
  });
});
