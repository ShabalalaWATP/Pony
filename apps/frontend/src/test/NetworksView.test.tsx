import { HttpResponse, http } from "msw";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { NetworksView } from "@/components/networks/NetworksView";
import { withQueryAndRouter } from "./helpers";
import { server } from "./msw/server";

describe("NetworksView", () => {
  it("renders APs and resolves SSID + BSSID + encryption", async () => {
    server.use(
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({
          items: [
            {
              bssid: "aa:bb:cc:dd:ee:01",
              ssid: "CafeWiFi",
              channel: 6,
              band: "2.4",
              encryption: ["WPA2"],
              signal_history: [{ rssi_dbm: -60 }],
              vendor_oui: "Apple",
            },
            {
              bssid: "aa:bb:cc:dd:ee:02",
              ssid: null,
              channel: 36,
              band: "5",
              encryption: ["OPEN"],
              signal_history: [],
              vendor_oui: null,
            },
          ],
          total: 2,
          limit: 500,
          offset: 0,
        }),
      ),
    );
    const { node } = withQueryAndRouter(<NetworksView />);
    render(node);
    expect(await screen.findByText("CafeWiFi")).toBeInTheDocument();
    expect(screen.getByText(/aa:bb:cc:dd:ee:02/)).toBeInTheDocument();
    expect(screen.getByText("WPA2")).toBeInTheDocument();
    expect(screen.getAllByText(/<hidden>/i).length).toBeGreaterThan(0);
  });

  it("opens the AP detail drawer when a row is clicked", async () => {
    server.use(
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({
          items: [
            {
              bssid: "aa:bb:cc:dd:ee:99",
              ssid: "DetailNet",
              channel: 11,
              band: "2.4",
              encryption: ["WPA3"],
              signal_history: [{ rssi_dbm: -50 }, { rssi_dbm: -55 }, { rssi_dbm: -52 }],
              vendor_oui: "TestVendor",
            },
          ],
          total: 1,
          limit: 500,
          offset: 0,
        }),
      ),
    );
    const { node } = withQueryAndRouter(<NetworksView />);
    render(node);
    const row = await screen.findByText("DetailNet");
    await userEvent.click(row);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/signal history/i)).toBeInTheDocument();
  });

  it("renders the location row when an AP has coordinates", async () => {
    server.use(
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({
          items: [
            {
              bssid: "aa:bb:cc:dd:ee:42",
              ssid: "GeoNet",
              channel: 6,
              encryption: ["WPA2"],
              signal_history: [],
              latitude: 51.50721,
              longitude: -0.1275,
              location_source: "sensor_gps",
            },
          ],
          total: 1,
          limit: 500,
          offset: 0,
        }),
      ),
    );
    const { node } = withQueryAndRouter(<NetworksView />);
    render(node);
    const row = await screen.findByText("GeoNet");
    await userEvent.click(row);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/51\.50721/)).toBeInTheDocument();
    expect(screen.getByText(/sensor gps/i)).toBeInTheDocument();
  });

  it("renders associated clients in the AP detail drawer", async () => {
    server.use(
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({
          items: [
            {
              bssid: "aa:bb:cc:dd:ee:55",
              ssid: "ClientsNet",
              channel: 6,
              encryption: ["WPA2"],
              signal_history: [],
            },
          ],
          total: 1,
          limit: 500,
          offset: 0,
        }),
      ),
      http.get("/api/v1/access_points/:bssid/clients", () =>
        HttpResponse.json({
          items: [
            {
              mac: "11:22:33:44:55:66",
              vendor_oui: "Foo Inc",
              associated_bssid: "aa:bb:cc:dd:ee:55",
              probes: [],
              signal_history: [{ rssi_dbm: -60 }],
              last_seen: new Date().toISOString(),
            },
          ],
          total: 1,
          limit: 50,
          offset: 0,
        }),
      ),
    );
    const { node } = withQueryAndRouter(<NetworksView />);
    render(node);
    const row = await screen.findByText("ClientsNet");
    await userEvent.click(row);
    const list = await screen.findByTestId("ap-associated-clients");
    expect(list).toBeInTheDocument();
    // MacAddress renders truncated by default in dense surfaces.
    expect(list).toHaveTextContent("11:22");
    expect(list).toHaveTextContent("55:66");
    expect(list).toHaveTextContent("Foo Inc");
  });

  it("shows an empty message when an AP has no associated clients", async () => {
    server.use(
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({
          items: [
            {
              bssid: "aa:bb:cc:dd:ee:77",
              ssid: "QuietNet",
              channel: 1,
              encryption: ["WPA2"],
              signal_history: [],
            },
          ],
          total: 1,
          limit: 500,
          offset: 0,
        }),
      ),
      http.get("/api/v1/access_points/:bssid/clients", () =>
        HttpResponse.json({ items: [], total: 0, limit: 50, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<NetworksView />);
    render(node);
    const row = await screen.findByText("QuietNet");
    await userEvent.click(row);
    expect(await screen.findByText(/no clients are currently associated/i)).toBeInTheDocument();
  });

  it("deep-link to a BSSID outside the visible page loads from the detail endpoint", async () => {
    server.use(
      // List page intentionally does not contain the deep-linked BSSID.
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({ items: [], total: 0, limit: 500, offset: 0 }),
      ),
      http.get("/api/v1/access_points/:bssid", () =>
        HttpResponse.json({
          bssid: "aa:bb:cc:dd:ee:de",
          ssid: "DeepLinkNet",
          channel: 6,
          encryption: ["WPA2"],
          signal_history: [{ rssi_dbm: -50 }],
        }),
      ),
    );
    const { node } = withQueryAndRouter(<NetworksView />, {
      initialPath: "/networks?bssid=aa:bb:cc:dd:ee:de",
    });
    render(node);
    expect(await screen.findByTestId("ap-detail")).toBeInTheDocument();
    expect(screen.getByText("DeepLinkNet")).toBeInTheDocument();
  });

  it("deep-link to an unknown BSSID renders the 'not seen yet' state", async () => {
    server.use(
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({ items: [], total: 0, limit: 500, offset: 0 }),
      ),
      http.get("/api/v1/access_points/:bssid", () =>
        HttpResponse.json({ detail: "not found" }, { status: 404 }),
      ),
    );
    const { node } = withQueryAndRouter(<NetworksView />, {
      initialPath: "/networks?bssid=aa:bb:cc:dd:ee:ff",
    });
    render(node);
    expect(await screen.findByText(/not seen yet/i)).toBeInTheDocument();
  });

  it("filters by SSID", async () => {
    server.use(
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({
          items: [
            { bssid: "aa:bb:cc:dd:ee:01", ssid: "Alpha", channel: 6, signal_history: [] },
            { bssid: "aa:bb:cc:dd:ee:02", ssid: "Bravo", channel: 11, signal_history: [] },
          ],
          total: 2,
          limit: 500,
          offset: 0,
        }),
      ),
    );
    const { node } = withQueryAndRouter(<NetworksView />);
    render(node);
    await screen.findByText("Alpha");
    await userEvent.type(screen.getByPlaceholderText(/filter by ssid/i), "brav");
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
  });
});
