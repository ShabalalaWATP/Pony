import { HttpResponse, http } from "msw";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PcapSection } from "@/components/pcap/PcapSection";
import { withQueryAndRouter } from "./helpers";
import { server } from "./msw/server";

const samplePcap = {
  id: "p1",
  engagement_id: "eng-1",
  filename_sanitized: "demo-deauth.pcapng",
  size_bytes: 5_242_880,
  sha256: "x".repeat(64),
  magic: "pcapng" as const,
  status: "uploaded" as const,
  uploaded_by: "u1",
  uploaded_at: new Date(Date.now() - 60_000).toISOString(),
  gridfs_id: "g1",
};

describe("PcapSection", () => {
  it("renders the empty state when no PCAPs exist", async () => {
    const { node } = withQueryAndRouter(<PcapSection engagementId="eng-1" />);
    render(node);
    expect(await screen.findByText(/no captures uploaded yet/i)).toBeInTheDocument();
  });

  it("renders one row per PCAP with filename, size, status", async () => {
    server.use(
      http.get("/api/v1/engagements/eng-1/pcaps", () =>
        HttpResponse.json({ items: [samplePcap], total: 1, limit: 100, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<PcapSection engagementId="eng-1" />);
    render(node);
    expect(await screen.findByText("demo-deauth.pcapng")).toBeInTheDocument();
    expect(screen.getByText(/5\.0 MB/)).toBeInTheDocument();
    expect(screen.getByTestId("pcap-status")).toHaveTextContent("uploaded");
  });

  it("shows the Analyze button only on status=uploaded rows", async () => {
    server.use(
      http.get("/api/v1/engagements/eng-1/pcaps", () =>
        HttpResponse.json({
          items: [
            samplePcap,
            {
              ...samplePcap,
              id: "p2",
              filename_sanitized: "demo-other.pcapng",
              status: "analyzed" as const,
            },
          ],
          total: 2,
          limit: 100,
          offset: 0,
        }),
      ),
    );
    const { node } = withQueryAndRouter(<PcapSection engagementId="eng-1" />);
    render(node);
    await screen.findByText("demo-deauth.pcapng");
    await screen.findByText("demo-other.pcapng");
    const analyzeButtons = screen.getAllByTestId("pcap-analyze-button");
    expect(analyzeButtons).toHaveLength(1);
  });

  it("opens the upload drawer when Upload PCAP is clicked", async () => {
    const { node } = withQueryAndRouter(<PcapSection engagementId="eng-1" />);
    render(node);
    await userEvent.click(await screen.findByTestId("pcap-upload-button"));
    expect(await screen.findByTestId("pcap-upload-form")).toBeInTheDocument();
  });

  it("opens the typed-confirm delete dialog when delete is clicked", async () => {
    server.use(
      http.get("/api/v1/engagements/eng-1/pcaps", () =>
        HttpResponse.json({ items: [samplePcap], total: 1, limit: 100, offset: 0 }),
      ),
    );
    const { node } = withQueryAndRouter(<PcapSection engagementId="eng-1" />);
    render(node);
    await screen.findByText("demo-deauth.pcapng");
    await userEvent.click(screen.getByTestId("pcap-delete-button"));
    expect(await screen.findByTestId("pcap-delete-confirm-button")).toBeDisabled();
    // fireEvent.change updates value + fires onChange synchronously —
    // works reliably regardless of how the surrounding Drawer mounts.
    fireEvent.change(screen.getByTestId("pcap-delete-confirm-input"), {
      target: { value: "DELETE" },
    });
    expect(screen.getByTestId("pcap-delete-confirm-button")).not.toBeDisabled();
  });
});
