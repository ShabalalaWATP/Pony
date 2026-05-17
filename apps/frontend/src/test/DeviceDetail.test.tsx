import { HttpResponse, http } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeviceDetail } from "@/components/devices/DeviceDetail";
import type { Client } from "@/services/api/queries";
import { withQuery } from "./helpers";
import { server } from "./msw/server";

const sampleDevice: Client = {
  mac: "38:c9:86:1c:33:a2",
  vendor_oui: "Samsung",
  associated_bssid: "a4:c3:f0:1d:88:0a",
  probes: ["HomeWifi", "CafeLink"],
  signal_history: [{ rssi_dbm: -62, seen_at: "2026-05-17T10:00:00Z" }],
  first_seen: "2026-05-17T09:00:00Z",
  last_seen: "2026-05-17T10:00:00Z",
};

describe("DeviceDetail", () => {
  it("renders the seeded device instantly", () => {
    const { node } = withQuery(<DeviceDetail mac={sampleDevice.mac} seed={sampleDevice} />);
    render(node);
    expect(screen.getByTestId("device-detail")).toBeInTheDocument();
    expect(screen.getByText(/Samsung/)).toBeInTheDocument();
    expect(screen.getByTestId("device-probes")).toHaveTextContent("HomeWifi");
  });

  it("loads the device from the detail endpoint when no seed is supplied", async () => {
    server.use(http.get("/api/v1/devices/:mac", () => HttpResponse.json(sampleDevice)));
    const { node } = withQuery(<DeviceDetail mac={sampleDevice.mac} />);
    render(node);
    expect(screen.getByTestId("device-detail-loading")).toBeInTheDocument();
    expect(await screen.findByTestId("device-detail")).toBeInTheDocument();
  });

  it("upgrades to the detail payload when it arrives", async () => {
    const fresh: Client = { ...sampleDevice, vendor_oui: "Samsung (fresh)" };
    server.use(http.get("/api/v1/devices/:mac", () => HttpResponse.json(fresh)));
    const stale: Client = { ...sampleDevice, vendor_oui: "Samsung (stale)" };
    const { node } = withQuery(<DeviceDetail mac={sampleDevice.mac} seed={stale} />);
    render(node);
    expect(screen.getByText(/Samsung \(stale\)/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Samsung \(fresh\)/)).toBeInTheDocument());
  });

  it("renders the 'not seen yet' empty state on a 404 deep-link", async () => {
    server.use(
      http.get("/api/v1/devices/:mac", () =>
        HttpResponse.json({ detail: "not found" }, { status: 404 }),
      ),
    );
    const { node } = withQuery(<DeviceDetail mac="11:22:33:44:55:66" />);
    render(node);
    expect(await screen.findByText(/not seen yet/i)).toBeInTheDocument();
  });

  it("keeps the seed visible when the detail endpoint returns 404 (transient)", async () => {
    server.use(
      http.get("/api/v1/devices/:mac", () =>
        HttpResponse.json({ detail: "not found" }, { status: 404 }),
      ),
    );
    const { node } = withQuery(<DeviceDetail mac={sampleDevice.mac} seed={sampleDevice} />);
    render(node);
    await waitFor(() => expect(screen.getByTestId("device-detail")).toBeInTheDocument());
    expect(screen.queryByText(/not seen yet/i)).toBeNull();
  });

  it("normalises MAC case before hitting the endpoint", async () => {
    let hitPath: string | null = null;
    server.use(
      http.get("/api/v1/devices/:mac", ({ request }) => {
        hitPath = new URL(request.url).pathname;
        return HttpResponse.json(sampleDevice);
      }),
    );
    const { node } = withQuery(<DeviceDetail mac="38:C9:86:1C:33:A2" />);
    render(node);
    await waitFor(() => expect(hitPath).toBe("/api/v1/devices/38%3Ac9%3A86%3A1c%3A33%3Aa2"));
  });
});
