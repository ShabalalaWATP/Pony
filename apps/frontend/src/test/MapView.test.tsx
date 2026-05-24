import { HttpResponse, http } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MapView } from "@/components/map/MapView";
import { withQueryAndRouter } from "./helpers";
import { useMapPinsStore } from "@/stores/useMapPinsStore";
import { useMapStyleStore } from "@/stores/useMapStyleStore";
import { server } from "./msw/server";

// `MapCanvas` is dynamically imported and pulls in MapLibre. It expects
// a real WebGL context and DOM measurements that jsdom doesn't supply,
// so we stub the lazy-loaded module wholesale for tests. The stub
// re-exports any data needed by integration assertions (style, pins,
// sensor markers, click callback).
interface MapCanvasStubProps {
  pins: Record<string, unknown>;
  style: unknown;
  sensorMarkers?: Record<string, { id: string; status: string }>;
  onSensorClick?: (id: string) => void;
}

vi.mock("@/components/map/MapCanvas", () => ({
  MapCanvas: ({ pins, style, sensorMarkers, onSensorClick }: MapCanvasStubProps) => {
    const styleId =
      typeof style === "string"
        ? "street"
        : style && typeof style === "object" && "sources" in style && "layers" in style
          ? Object.keys((style as { sources: Record<string, unknown> }).sources).length === 0
            ? "street"
            : Object.keys((style as { sources: Record<string, unknown> }).sources).includes(
                  "esri-labels",
                )
              ? "hybrid"
              : "satellite"
          : "unknown";
    const sensors = sensorMarkers ?? {};
    return (
      <div
        data-testid="map-canvas-stub"
        data-style-id={styleId}
        data-sensor-count={Object.keys(sensors).length}
      >
        {Object.keys(pins).length} pins
        {Object.entries(sensors).map(([id, sm]) => (
          <button
            key={id}
            type="button"
            data-testid={`canvas-sensor-${id}`}
            data-sensor-status={sm.status}
            onClick={() => onSensorClick?.(id)}
          >
            {id}
          </button>
        ))}
      </div>
    );
  },
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
  beforeEach(() => {
    // Map base layer is persisted to localStorage in real use — reset
    // between tests so the switcher integration cases start clean.
    useMapStyleStore.setState({ styleId: "street" });
  });

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

  it("renders an empty state when neither APs nor sensors exist", async () => {
    useMapPinsStore.setState({ pins: {} });
    server.use(
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({ items: [], total: 0, limit: 500, offset: 0 }),
      ),
      // Sensors API is admin-gated and returns 403 by default; that
      // path means "no sensor layer" without erroring the view, so
      // the empty state still wins when APs are also empty.
    );
    const { node } = withQueryAndRouter(<MapView />);
    render(node);
    expect(await screen.findByText(/no access points or sensors to show yet/i)).toBeInTheDocument();
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

  it("renders the base-layer switcher in the header", async () => {
    useMapPinsStore.setState({ pins: {} });
    const { node } = withQueryAndRouter(<MapView />);
    render(node);
    expect(await screen.findByTestId("map-style-switcher")).toBeInTheDocument();
  });

  it("passes the street style descriptor to MapCanvas by default", async () => {
    useMapPinsStore.setState({ pins: {} });
    server.use(
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({ items: sampleAps, total: 2, limit: 500, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<MapView />);
    render(node);
    const canvas = await screen.findByTestId("map-canvas-stub");
    expect(canvas).toHaveAttribute("data-style-id", "street");
  });

  it("switches MapCanvas style when the operator picks satellite", async () => {
    useMapPinsStore.setState({ pins: {} });
    server.use(
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({ items: sampleAps, total: 2, limit: 500, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<MapView />);
    render(node);
    await screen.findByTestId("map-canvas-stub");
    await userEvent.click(screen.getByTestId("map-style-satellite"));
    await waitFor(() => {
      expect(screen.getByTestId("map-canvas-stub")).toHaveAttribute("data-style-id", "satellite");
    });
  });

  it("switches MapCanvas style to hybrid when the operator picks it", async () => {
    useMapPinsStore.setState({ pins: {} });
    server.use(
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({ items: sampleAps, total: 2, limit: 500, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<MapView />);
    render(node);
    await screen.findByTestId("map-canvas-stub");
    await userEvent.click(screen.getByTestId("map-style-hybrid"));
    await waitFor(() => {
      expect(screen.getByTestId("map-canvas-stub")).toHaveAttribute("data-style-id", "hybrid");
    });
  });

  it("renders only sensors with both lat AND lng as canvas markers", async () => {
    useMapPinsStore.setState({ pins: {} });
    server.use(
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({ items: sampleAps, total: 2, limit: 500, offset: 0 }),
      ),
      http.get("/api/v1/sensors", () =>
        HttpResponse.json({
          items: [
            {
              id: "sensor-uk-1",
              name: "synth-pi-0",
              tailnet_ip: "100.64.0.10",
              version: "0.1.0",
              capabilities: ["passive_capture"],
              last_seen: new Date(Date.now() - 5_000).toISOString(),
              revoked: false,
              latitude: 51.5,
              longitude: -0.1,
            },
            {
              id: "sensor-no-coords",
              name: "synth-pi-nogeo",
              tailnet_ip: "100.64.0.11",
              version: "0.1.0",
              capabilities: ["passive_capture"],
              last_seen: new Date(Date.now() - 5_000).toISOString(),
              revoked: false,
              latitude: null,
              longitude: null,
            },
          ],
          total: 2,
          limit: 500,
          offset: 0,
        }),
      ),
    );
    const { node } = withQueryAndRouter(<MapView />);
    render(node);
    const canvas = await screen.findByTestId("map-canvas-stub");
    await waitFor(() => {
      expect(canvas).toHaveAttribute("data-sensor-count", "1");
    });
    expect(screen.getByTestId("canvas-sensor-sensor-uk-1")).toBeInTheDocument();
    expect(screen.queryByTestId("canvas-sensor-sensor-no-coords")).toBeNull();
  });

  it("classifies sensor markers via sensorStatus (live in this fixture)", async () => {
    useMapPinsStore.setState({ pins: {} });
    server.use(
      http.get("/api/v1/sensors", () =>
        HttpResponse.json({
          items: [
            {
              id: "sensor-live",
              name: "live-pi",
              tailnet_ip: "100.64.0.10",
              version: "0.1.0",
              capabilities: ["passive_capture"],
              last_seen: new Date(Date.now() - 5_000).toISOString(),
              revoked: false,
              latitude: 51.5,
              longitude: -0.1,
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
    const marker = await screen.findByTestId("canvas-sensor-sensor-live");
    expect(marker).toHaveAttribute("data-sensor-status", "live");
  });

  it("renders the sensor-count badge in the header", async () => {
    useMapPinsStore.setState({ pins: {} });
    server.use(
      http.get("/api/v1/sensors", () =>
        HttpResponse.json({
          items: [
            {
              id: "s-1",
              name: "n",
              tailnet_ip: "1.1.1.1",
              version: "0",
              capabilities: [],
              last_seen: new Date().toISOString(),
              revoked: false,
              latitude: 51,
              longitude: -0.1,
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
    expect(await screen.findByTestId("map-sensor-count")).toHaveTextContent(/1 sensor/i);
  });

  it("renders the canvas even when only sensors (no APs) are present", async () => {
    useMapPinsStore.setState({ pins: {} });
    server.use(
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({ items: [], total: 0, limit: 500, offset: 0 }),
      ),
      http.get("/api/v1/sensors", () =>
        HttpResponse.json({
          items: [
            {
              id: "lone-sensor",
              name: "n",
              tailnet_ip: "1.1.1.1",
              version: "0",
              capabilities: [],
              last_seen: new Date().toISOString(),
              revoked: false,
              latitude: 51,
              longitude: -0.1,
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
    expect(await screen.findByTestId("map-canvas-stub")).toBeInTheDocument();
    expect(screen.queryByText(/no access points or sensors to show yet/i)).toBeNull();
  });
});
