import { HttpResponse, http } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { RevokeSensorAction } from "@/components/sensors/RevokeSensorAction";
import type { Sensor } from "@/services/api/queries";
import { withQuery } from "./helpers";
import { server } from "./msw/server";

const baseSensor: Sensor = {
  id: "pi-attic-01",
  name: "Attic Pi",
  tailnet_ip: "100.64.0.12",
  version: "0.1.0",
  capabilities: ["passive_capture"],
  revoked: false,
  last_seen: "2026-05-17T10:00:00Z",
  synthetic: false,
};

describe("RevokeSensorAction", () => {
  it("renders an inert chip when the sensor is already revoked", () => {
    const { node } = withQuery(<RevokeSensorAction sensor={{ ...baseSensor, revoked: true }} />);
    render(node);
    expect(screen.getByTestId("sensor-already-revoked")).toBeInTheDocument();
    expect(screen.queryByTestId("sensor-revoke-open")).toBeNull();
  });

  it("hides the form until the operator opens it", () => {
    const { node } = withQuery(<RevokeSensorAction sensor={baseSensor} />);
    render(node);
    expect(screen.queryByTestId("sensor-revoke-form")).toBeNull();
    expect(screen.getByTestId("sensor-revoke-open")).toBeInTheDocument();
  });

  it("keeps the confirm button disabled until the id is typed verbatim", async () => {
    const { node } = withQuery(<RevokeSensorAction sensor={baseSensor} />);
    render(node);
    await userEvent.click(screen.getByTestId("sensor-revoke-open"));
    const confirm = screen.getByRole("button", { name: /^revoke certificate$/i });
    expect(confirm).toBeDisabled();
    const input = screen.getByLabelText(/type the sensor id to confirm revocation/i);
    await userEvent.type(input, "pi-attic-0");
    expect(confirm).toBeDisabled();
    await userEvent.type(input, "1");
    expect(confirm).not.toBeDisabled();
  });

  it("POSTs the revoke endpoint and surfaces success", async () => {
    let hit = false;
    server.use(
      http.post("/api/v1/sensors/:sensorId/revoke", () => {
        hit = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { node } = withQuery(<RevokeSensorAction sensor={baseSensor} />);
    render(node);
    await userEvent.click(screen.getByTestId("sensor-revoke-open"));
    await userEvent.type(
      screen.getByLabelText(/type the sensor id to confirm revocation/i),
      baseSensor.id,
    );
    await userEvent.click(screen.getByRole("button", { name: /^revoke certificate$/i }));
    await waitFor(() => expect(hit).toBe(true));
    expect(await screen.findByTestId("sensor-revoke-success")).toBeInTheDocument();
  });

  it("surfaces admin/2FA copy on a 403", async () => {
    server.use(
      http.post("/api/v1/sensors/:sensorId/revoke", () =>
        HttpResponse.json({ detail: "Admin required" }, { status: 403 }),
      ),
    );
    const { node } = withQuery(<RevokeSensorAction sensor={baseSensor} />);
    render(node);
    await userEvent.click(screen.getByTestId("sensor-revoke-open"));
    await userEvent.type(
      screen.getByLabelText(/type the sensor id to confirm revocation/i),
      baseSensor.id,
    );
    await userEvent.click(screen.getByRole("button", { name: /^revoke certificate$/i }));
    expect(await screen.findByTestId("sensor-revoke-error")).toHaveTextContent(
      /admin role \+ recent totp/i,
    );
  });

  it("cancels back to the inert chip when Cancel is clicked", async () => {
    const { node } = withQuery(<RevokeSensorAction sensor={baseSensor} />);
    render(node);
    await userEvent.click(screen.getByTestId("sensor-revoke-open"));
    expect(screen.getByTestId("sensor-revoke-form")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByTestId("sensor-revoke-form")).toBeNull();
    expect(screen.getByTestId("sensor-revoke-open")).toBeInTheDocument();
  });
});
