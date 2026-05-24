import { HttpResponse, http } from "msw";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EvilTwinsView } from "@/components/networks/EvilTwinsView";
import { withQueryAndRouter } from "./helpers";
import { server } from "./msw/server";

describe("EvilTwinsView", () => {
  it("renders the empty state when no candidates exist", async () => {
    const { node } = withQueryAndRouter(<EvilTwinsView />);
    render(node);
    expect(await screen.findByText(/no candidates detected/i)).toBeInTheDocument();
  });

  it("renders one card per candidate with BSSIDs and suspicion", async () => {
    server.use(
      http.get("/api/v1/access_points/evil-twin-candidates", () =>
        HttpResponse.json({
          items: [
            {
              ssid: "AcmeCorp-Guest",
              candidates: ["aa:bb:cc:dd:ee:01", "aa:bb:cc:dd:ee:99"],
              suspicion: 0.85,
            },
            {
              ssid: "FREE-WIFI",
              candidates: ["aa:bb:cc:dd:ee:02", "aa:bb:cc:dd:ee:03"],
              suspicion: 0.45,
            },
          ],
          total: 2,
          limit: 200,
          offset: 0,
        }),
      ),
    );
    const { node } = withQueryAndRouter(<EvilTwinsView />);
    render(node);
    expect(await screen.findByText("AcmeCorp-Guest")).toBeInTheDocument();
    expect(screen.getByText("FREE-WIFI")).toBeInTheDocument();
    expect(screen.getAllByTestId("evil-twin-candidate")).toHaveLength(2);
    expect(screen.getByText(/85% suspicion/)).toBeInTheDocument();
    expect(screen.getByText(/45% suspicion/)).toBeInTheDocument();
  });

  it("colours the suspicion badge by tier (red ≥ 0.7, amber ≥ 0.4, neutral otherwise)", async () => {
    server.use(
      http.get("/api/v1/access_points/evil-twin-candidates", () =>
        HttpResponse.json({
          items: [
            { ssid: "highSus", candidates: ["aa:bb:cc:dd:ee:01"], suspicion: 0.95 },
            { ssid: "midSus", candidates: ["aa:bb:cc:dd:ee:02"], suspicion: 0.55 },
            { ssid: "lowSus", candidates: ["aa:bb:cc:dd:ee:03"], suspicion: 0.15 },
          ],
          total: 3,
          limit: 200,
          offset: 0,
        }),
      ),
    );
    const { node } = withQueryAndRouter(<EvilTwinsView />);
    render(node);
    await screen.findByText("highSus");
    const badges = screen.getAllByTestId("suspicion-badge");
    expect(badges).toHaveLength(3);
    // Red, amber, neutral can be asserted by the inline classes
    // (`text-accent-red`, `text-accent-amber`, `text-fg-80`).
    expect(badges[0]?.className).toMatch(/accent-red/);
    expect(badges[1]?.className).toMatch(/accent-amber/);
    expect(badges[2]?.className).toMatch(/fg-80|neutral/);
  });

  it("filters cards by SSID substring", async () => {
    server.use(
      http.get("/api/v1/access_points/evil-twin-candidates", () =>
        HttpResponse.json({
          items: [
            { ssid: "AcmeCorp", candidates: ["aa:bb:cc:dd:ee:01"], suspicion: 0.5 },
            { ssid: "Starbucks", candidates: ["aa:bb:cc:dd:ee:02"], suspicion: 0.5 },
          ],
          total: 2,
          limit: 200,
          offset: 0,
        }),
      ),
    );
    const { node } = withQueryAndRouter(<EvilTwinsView />);
    render(node);
    await screen.findByText("AcmeCorp");
    const userEvent = await import("@testing-library/user-event");
    await userEvent.default.type(screen.getByPlaceholderText(/filter by ssid/i), "Star");
    expect(screen.queryByText("AcmeCorp")).toBeNull();
    expect(screen.getByText("Starbucks")).toBeInTheDocument();
  });
});
