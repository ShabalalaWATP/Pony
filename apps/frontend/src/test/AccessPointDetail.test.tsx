import { HttpResponse, http } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AccessPointDetail } from "@/components/networks/AccessPointDetail";
import type { AccessPoint } from "@/services/api/queries";
import { withQuery } from "./helpers";
import { server } from "./msw/server";

const sampleAp: AccessPoint = {
  bssid: "aa:bb:cc:dd:ee:01",
  ssid: "TestNet",
  channel: 6,
  band: "2.4",
  encryption: ["WPA2"],
  signal_history: [{ rssi_dbm: -55, seen_at: "2026-05-17T10:00:00Z" }],
  vendor_oui: "Apple",
  anomaly_reasons: [],
  anomaly_score: 0,
  label: "unknown",
  label_confidence: 0,
  first_seen: "2026-05-17T09:00:00Z",
  last_seen: "2026-05-17T10:00:00Z",
  synthetic: false,
};

describe("AccessPointDetail", () => {
  it("renders the seeded AP instantly without waiting for the detail query", () => {
    const { node } = withQuery(<AccessPointDetail bssid={sampleAp.bssid} seed={sampleAp} />);
    render(node);
    expect(screen.getByTestId("ap-detail")).toBeInTheDocument();
    expect(screen.getByText("TestNet")).toBeInTheDocument();
  });

  it("upgrades to the detail payload when it arrives (fresher signal history)", async () => {
    const fresh = {
      ...sampleAp,
      signal_history: [
        { rssi_dbm: -55, seen_at: "2026-05-17T10:00:00Z" },
        { rssi_dbm: -45, seen_at: "2026-05-17T10:01:00Z" },
      ],
      vendor_oui: "Apple (fresh)",
    };
    server.use(http.get("/api/v1/access_points/:bssid", () => HttpResponse.json(fresh)));
    const stale = { ...sampleAp, vendor_oui: "Apple (stale)" };
    const { node } = withQuery(<AccessPointDetail bssid={sampleAp.bssid} seed={stale} />);
    render(node);
    // seed renders first
    expect(screen.getByText(/Apple \(stale\)/)).toBeInTheDocument();
    // then the detail payload replaces it
    await waitFor(() => expect(screen.getByText(/Apple \(fresh\)/)).toBeInTheDocument());
  });

  it("loads the AP from the detail endpoint when no seed is supplied (deep-link)", async () => {
    server.use(http.get("/api/v1/access_points/:bssid", () => HttpResponse.json(sampleAp)));
    const { node } = withQuery(<AccessPointDetail bssid={sampleAp.bssid} />);
    render(node);
    expect(screen.getByTestId("ap-detail-loading")).toBeInTheDocument();
    expect(await screen.findByTestId("ap-detail")).toBeInTheDocument();
    expect(screen.getByText("TestNet")).toBeInTheDocument();
  });

  it("renders the 'not seen yet' empty state on a 404 deep-link", async () => {
    server.use(
      http.get("/api/v1/access_points/:bssid", () =>
        HttpResponse.json({ detail: "not found" }, { status: 404 }),
      ),
    );
    const { node } = withQuery(<AccessPointDetail bssid="aa:bb:cc:dd:ee:99" />);
    render(node);
    expect(await screen.findByText(/not seen yet/i)).toBeInTheDocument();
  });

  it("keeps the seed visible when the detail endpoint returns 404 (transient)", async () => {
    server.use(
      http.get("/api/v1/access_points/:bssid", () =>
        HttpResponse.json({ detail: "not found" }, { status: 404 }),
      ),
    );
    const { node } = withQuery(<AccessPointDetail bssid={sampleAp.bssid} seed={sampleAp} />);
    render(node);
    // Wait for the query to settle, then confirm the seed is still shown.
    await waitFor(() => expect(screen.getByTestId("ap-detail")).toBeInTheDocument());
    expect(screen.getByText("TestNet")).toBeInTheDocument();
    expect(screen.queryByText(/not seen yet/i)).toBeNull();
  });

  it("renders the sign-in empty state on a 401 deep-link", async () => {
    server.use(
      http.get("/api/v1/access_points/:bssid", () =>
        HttpResponse.json({ detail: "not authenticated" }, { status: 401 }),
      ),
    );
    const { node } = withQuery(<AccessPointDetail bssid="aa:bb:cc:dd:ee:33" />);
    render(node);
    expect(await screen.findByText(/sign in required/i)).toBeInTheDocument();
  });

  it("normalises BSSID case before hitting the endpoint", async () => {
    let hitPath: string | null = null;
    server.use(
      http.get("/api/v1/access_points/:bssid", ({ request }) => {
        hitPath = new URL(request.url).pathname;
        return HttpResponse.json(sampleAp);
      }),
    );
    const { node } = withQuery(<AccessPointDetail bssid="AA:BB:CC:DD:EE:01" />);
    render(node);
    await waitFor(() => expect(hitPath).toBe("/api/v1/access_points/aa%3Abb%3Acc%3Add%3Aee%3A01"));
  });
});
