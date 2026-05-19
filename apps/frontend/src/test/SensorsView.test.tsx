import { HttpResponse, http } from "msw";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SensorsView } from "@/components/sensors/SensorsView";
import { withQueryAndRouter } from "./helpers";
import { server } from "./msw/server";

const ts = (offsetMs: number) => new Date(Date.now() - offsetMs).toISOString();

describe("SensorsView", () => {
  it("renders sensors returned from the backend", async () => {
    server.use(
      http.get("/api/v1/sensors", () =>
        HttpResponse.json({
          items: [
            {
              id: "sensor-1",
              name: "wlan-pi-01",
              tailnet_ip: "100.64.0.10",
              version: "0.1.0",
              capabilities: ["passive_capture"],
              last_seen: ts(2_000),
              revoked: false,
            },
            {
              id: "sensor-2",
              name: "wlan-pi-02",
              tailnet_ip: "100.64.0.11",
              version: "0.1.0",
              capabilities: ["passive_capture", "channel_control"],
              last_seen: ts(120_000),
              revoked: false,
            },
          ],
          total: 2,
          limit: 500,
          offset: 0,
        }),
      ),
    );
    const { node } = withQueryAndRouter(<SensorsView />, { initialPath: "/sensors" });
    render(node);
    expect(await screen.findByText("wlan-pi-01")).toBeInTheDocument();
    expect(screen.getByText("wlan-pi-02")).toBeInTheDocument();
  });

  it("flags GPS-capable sensors with the geo icon", async () => {
    server.use(
      http.get("/api/v1/sensors", () =>
        HttpResponse.json({
          items: [
            {
              id: "geo-pi",
              name: "wlan-pi-geo",
              tailnet_ip: "100.64.0.20",
              version: "0.1.0",
              capabilities: ["passive_capture", "geo"],
              last_seen: ts(2_000),
              revoked: false,
            },
            {
              id: "no-geo-pi",
              name: "wlan-pi-no-geo",
              tailnet_ip: "100.64.0.21",
              version: "0.1.0",
              capabilities: ["passive_capture"],
              last_seen: ts(2_000),
              revoked: false,
            },
          ],
          total: 2,
          limit: 500,
          offset: 0,
        }),
      ),
    );
    const { node } = withQueryAndRouter(<SensorsView />);
    render(node);
    await screen.findByText("wlan-pi-geo");
    // Exactly one geo icon — only on the GPS-capable sensor row.
    expect(screen.getAllByTestId("sensor-geo-icon")).toHaveLength(1);
  });

  it("shows the admin-required empty state on 403", async () => {
    const { node } = withQueryAndRouter(<SensorsView />);
    render(node);
    // Default msw handler returns 403.
    expect(await screen.findByText(/admin \+ 2fa required/i)).toBeInTheDocument();
  });

  it("filters the list when typing in the search box", async () => {
    server.use(
      http.get("/api/v1/sensors", () =>
        HttpResponse.json({
          items: [
            {
              id: "s1",
              name: "alpha",
              tailnet_ip: "1.1.1.1",
              version: "0",
              capabilities: [],
              revoked: false,
            },
            {
              id: "s2",
              name: "bravo",
              tailnet_ip: "1.1.1.2",
              version: "0",
              capabilities: [],
              revoked: false,
            },
          ],
          total: 2,
          limit: 500,
          offset: 0,
        }),
      ),
    );
    const { node } = withQueryAndRouter(<SensorsView />);
    render(node);
    await screen.findByText("alpha");
    await userEvent.type(screen.getByPlaceholderText(/filter by name/i), "brav");
    expect(screen.queryByText("alpha")).toBeNull();
    expect(screen.getByText("bravo")).toBeInTheDocument();
  });

  it("opens the register drawer when the New sensor button is clicked", async () => {
    server.use(
      http.get("/api/v1/sensors", () =>
        HttpResponse.json({ items: [], total: 0, limit: 500, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<SensorsView />);
    render(node);
    await screen.findByTestId("sensors-new");
    await userEvent.click(screen.getByTestId("sensors-new"));
    expect(await screen.findByTestId("register-sensor-form")).toBeInTheDocument();
  });

  // Note: `?new=1` deep-link is exercised via the route file's
  // `validateSearch`, which the test router doesn't apply — relying on
  // the real route declaration to wire the param through.

  it("opens the detail drawer when a row is clicked", async () => {
    server.use(
      http.get("/api/v1/sensors", () =>
        HttpResponse.json({
          items: [
            {
              id: "sensor-detail",
              name: "Detail Pi",
              tailnet_ip: "100.64.0.99",
              version: "0.2.0",
              capabilities: ["passive_capture", "channel_control"],
              last_seen: ts(2_000),
              revoked: false,
            },
          ],
          total: 1,
          limit: 500,
          offset: 0,
        }),
      ),
    );
    const { node } = withQueryAndRouter(<SensorsView />);
    render(node);
    const row = await screen.findByText("Detail Pi");
    await userEvent.click(row);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByText(/passive capture/i).length).toBeGreaterThan(0);
    expect(screen.getByText("sensor-detail")).toBeInTheDocument();
  });
});
