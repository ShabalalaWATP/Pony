import { HttpResponse, http } from "msw";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DevicesView } from "@/components/devices/DevicesView";
import { withQueryAndRouter } from "./helpers";
import { server } from "./msw/server";

describe("DevicesView", () => {
  it("renders clients and their vendors", async () => {
    server.use(
      http.get("/api/v1/devices", () =>
        HttpResponse.json({
          items: [
            {
              mac: "38:c9:86:1c:33:a2",
              vendor_oui: "Samsung",
              associated_bssid: "aa:bb:cc:dd:ee:01",
              probes: ["home", "office"],
              signal_history: [{ rssi_dbm: -55 }],
            },
            {
              mac: "a4:c3:f0:1d:88:0a",
              vendor_oui: "Apple",
              associated_bssid: null,
              probes: [],
              signal_history: [],
            },
          ],
          total: 2,
          limit: 500,
          offset: 0,
        }),
      ),
    );
    const { node } = withQueryAndRouter(<DevicesView />);
    render(node);
    expect(await screen.findByText("Samsung")).toBeInTheDocument();
    expect(screen.getByText("Apple")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders the empty state when no clients are returned", async () => {
    server.use(
      http.get("/api/v1/devices", () =>
        HttpResponse.json({ items: [], total: 0, limit: 500, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<DevicesView />);
    render(node);
    expect(await screen.findByText(/no clients observed yet/i)).toBeInTheDocument();
  });

  it("opens the client detail drawer when a row is clicked", async () => {
    server.use(
      http.get("/api/v1/devices", () =>
        HttpResponse.json({
          items: [
            {
              mac: "11:22:33:44:55:66",
              vendor_oui: "DetailCo",
              associated_bssid: "aa:bb:cc:dd:ee:01",
              probes: ["home", "office", "cafe"],
              signal_history: [{ rssi_dbm: -50 }, { rssi_dbm: -52 }],
            },
          ],
          total: 1,
          limit: 500,
          offset: 0,
        }),
      ),
    );
    const { node } = withQueryAndRouter(<DevicesView />);
    render(node);
    const row = await screen.findByText("DetailCo");
    await userEvent.click(row);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("office")).toBeInTheDocument();
  });

  it("deep-link to a MAC outside the visible page loads from the detail endpoint", async () => {
    server.use(
      http.get("/api/v1/devices", () =>
        HttpResponse.json({ items: [], total: 0, limit: 500, offset: 0 }),
      ),
      http.get("/api/v1/devices/:mac", () =>
        HttpResponse.json({
          mac: "de:ad:be:ef:00:01",
          vendor_oui: "DeepLinkCo",
          associated_bssid: null,
          probes: ["alpha"],
          signal_history: [],
        }),
      ),
    );
    const { node } = withQueryAndRouter(<DevicesView />, {
      initialPath: "/devices?mac=de:ad:be:ef:00:01",
    });
    render(node);
    expect(await screen.findByTestId("device-detail")).toBeInTheDocument();
    expect(screen.getByText("DeepLinkCo")).toBeInTheDocument();
  });

  it("deep-link to an unknown MAC renders the 'not seen yet' state", async () => {
    server.use(
      http.get("/api/v1/devices", () =>
        HttpResponse.json({ items: [], total: 0, limit: 500, offset: 0 }),
      ),
      http.get("/api/v1/devices/:mac", () =>
        HttpResponse.json({ detail: "not found" }, { status: 404 }),
      ),
    );
    const { node } = withQueryAndRouter(<DevicesView />, {
      initialPath: "/devices?mac=ff:ff:ff:ff:ff:ff",
    });
    render(node);
    expect(await screen.findByText(/not seen yet/i)).toBeInTheDocument();
  });
});
