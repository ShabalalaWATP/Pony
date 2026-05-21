import { HttpResponse, http } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OverviewKPIs } from "@/components/overview/OverviewKPIs";
import { OverviewSignalHistogram } from "@/components/overview/OverviewSignalHistogram";
import { fixtures } from "./msw/handlers";
import { withQueryAndRouter } from "./helpers";
import { server } from "./msw/server";

// Recharts uses ResizeObserver to measure its container. The global
// shim in test/setup.ts covers it; nothing to do here.

describe("OverviewKPIs", () => {
  it("renders totals from the HTTP endpoints", async () => {
    server.use(
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({ items: [], total: 312, limit: 1, offset: 0 }),
      ),
      http.get("/api/v1/devices", () =>
        HttpResponse.json({ items: [], total: 1482, limit: 1, offset: 0 }),
      ),
      http.get("/api/v1/sensors", () =>
        HttpResponse.json({ items: [], total: 5, limit: 1, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<OverviewKPIs />);
    render(node);
    await waitFor(() => {
      expect(screen.getByText("312")).toBeInTheDocument();
      expect(screen.getByText("1,482")).toBeInTheDocument();
      expect(screen.getByText("5")).toBeInTheDocument();
    });
  });

  it("renders a 'Gated' lock state on the sensors tile when the backend returns 403", async () => {
    const { node } = withQueryAndRouter(<OverviewKPIs />);
    render(node);
    // Default sensors handler is 403 — the tile flips to the gated
    // visual (lock icon + amber 'Gated' label) instead of an em-dash so
    // the operator can't misread it as "no data on file".
    await waitFor(() => {
      expect(screen.getByText(/^Gated$/)).toBeInTheDocument();
    });
  });
});

describe("OverviewSignalHistogram", () => {
  it("renders an empty state when no APs have signal history", async () => {
    server.use(
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({ items: [], total: 0, limit: 500, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<OverviewSignalHistogram />);
    render(node);
    expect(await screen.findByText(/no signal samples yet/i)).toBeInTheDocument();
  });

  it("buckets the RSSI samples and renders the chart container", async () => {
    server.use(
      http.get("/api/v1/access_points", () =>
        HttpResponse.json({
          items: [
            {
              ...fixtures.accessPoint,
              bssid: "aa:bb:cc:dd:ee:01",
              signal_history: [{ rssi_dbm: -60 }],
            },
            {
              ...fixtures.accessPoint,
              bssid: "aa:bb:cc:dd:ee:02",
              signal_history: [{ rssi_dbm: -70 }],
            },
            {
              ...fixtures.accessPoint,
              bssid: "aa:bb:cc:dd:ee:03",
              signal_history: [{ rssi_dbm: -80 }],
            },
          ],
          total: 3,
          limit: 500,
          offset: 0,
        }),
      ),
    );
    const { node } = withQueryAndRouter(<OverviewSignalHistogram />);
    render(node);
    expect(await screen.findByTestId("signal-histogram")).toBeInTheDocument();
    expect(screen.getByText(/n=3/)).toBeInTheDocument();
  });
});

// OverviewRecentAlerts now has its own test file (OverviewRecentAlerts.test.tsx)
// covering the real backend wiring, WS push, and ack flow. The placeholder test
// that lived here is retired.
