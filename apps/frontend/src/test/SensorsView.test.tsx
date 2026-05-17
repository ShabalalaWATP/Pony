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
