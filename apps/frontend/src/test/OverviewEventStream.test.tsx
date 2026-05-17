import { HttpResponse, http } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OverviewEventStream } from "@/components/overview/OverviewEventStream";
import { withQueryAndRouter } from "./helpers";
import { fixtures } from "./msw/handlers";
import { server } from "./msw/server";

describe("OverviewEventStream", () => {
  it("seeds from the HTTP page when events exist", async () => {
    const { node } = withQueryAndRouter(<OverviewEventStream />);
    render(node);
    expect(await screen.findByText(/TestNet/i)).toBeInTheDocument();
  });

  it("renders the empty state when the page is empty", async () => {
    server.use(
      http.get("/api/v1/events", () =>
        HttpResponse.json({ items: [], total: 0, limit: 50, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<OverviewEventStream />);
    render(node);
    expect(await screen.findByText(/no events yet/i)).toBeInTheDocument();
  });

  it("renders multiple event rows and labels their kind", async () => {
    server.use(
      http.get("/api/v1/events", () =>
        HttpResponse.json({
          items: [
            { ...fixtures.event, id: "e1", kind: "access_point_seen", payload: { ssid: "Net1" } },
            {
              ...fixtures.event,
              id: "e2",
              kind: "client_seen",
              payload: { mac: "00:11:22:33:44:55" },
            },
            {
              ...fixtures.event,
              id: "e3",
              kind: "sensor_status",
              payload: { status: "healthy" },
            },
          ],
          total: 3,
          limit: 50,
          offset: 0,
        }),
      ),
    );
    const { node } = withQueryAndRouter(<OverviewEventStream />);
    render(node);
    await waitFor(() => {
      expect(screen.getByText(/access point seen/i)).toBeInTheDocument();
      expect(screen.getByText(/client seen/i)).toBeInTheDocument();
      expect(screen.getByText(/sensor status/i)).toBeInTheDocument();
    });
  });
});
