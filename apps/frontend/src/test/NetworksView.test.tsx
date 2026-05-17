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
