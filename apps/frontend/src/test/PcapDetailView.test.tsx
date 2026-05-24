import { HttpResponse, http } from "msw";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PcapDetailView } from "@/components/pcap/PcapDetailView";
import { withQueryAndRouter } from "./helpers";
import { server } from "./msw/server";

function setAnalysis(status: string | null, counts: Record<string, number> = {}): void {
  server.use(
    http.get("/api/v1/engagements/eng-1/pcaps/p1/analysis", () =>
      HttpResponse.json({
        analysis: status === null ? null : { status, actor_id: "a", engagement_id: "eng-1" },
        finding_counts: counts,
      }),
    ),
  );
}

function setFindings(items: unknown[]): void {
  server.use(
    http.get("/api/v1/engagements/eng-1/pcaps/p1/findings", () =>
      HttpResponse.json({ items, total: items.length, limit: 100, offset: 0 }),
    ),
  );
}

const baseFinding = {
  id: "f1",
  pcap_id: "p1",
  engagement_id: "eng-1",
  analysis_id: "a1",
  severity: "info" as const,
  summary: "test summary",
  generated_at: new Date().toISOString(),
};

describe("PcapDetailView", () => {
  it("shows the empty state when no findings exist", async () => {
    const { node } = withQueryAndRouter(<PcapDetailView engagementId="eng-1" pcapId="p1" />);
    render(node);
    expect(await screen.findByText(/no findings/i)).toBeInTheDocument();
  });

  it("shows running banner + 'analysis in progress' copy", async () => {
    setAnalysis("running");
    const { node } = withQueryAndRouter(<PcapDetailView engagementId="eng-1" pcapId="p1" />);
    render(node);
    expect(await screen.findByText(/analysis in progress/i)).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
  });

  it("renders a finding card per item with severity + kind", async () => {
    setAnalysis("completed", { deauth_bursts: 1 });
    setFindings([
      {
        ...baseFinding,
        kind: "deauth_bursts",
        severity: "high",
        evidence: {
          threshold: 10,
          bursts: [
            {
              bssid: "aa:bb:cc:dd:ee:01",
              count: 25,
              first_seen_epoch: 1_700_000_000,
              last_seen_epoch: 1_700_000_300,
            },
          ],
        },
      },
    ]);
    const { node } = withQueryAndRouter(<PcapDetailView engagementId="eng-1" pcapId="p1" />);
    render(node);
    const card = await screen.findByTestId("finding-card");
    expect(card).toHaveAttribute("data-finding-kind", "deauth_bursts");
    expect(card).toHaveTextContent(/high/i);
    expect(screen.getByTestId("deauth-bursts-table")).toBeInTheDocument();
  });

  it("dispatches each evidence kind to its renderer (protocol_hierarchy)", async () => {
    setAnalysis("completed", { protocol_hierarchy: 1 });
    setFindings([
      {
        ...baseFinding,
        kind: "protocol_hierarchy",
        severity: "info",
        evidence: {
          protocols: [
            { protocol: "eth", depth: 0, frames: 1000, bytes: 524288 },
            { protocol: "tcp", depth: 1, frames: 800, bytes: 400000 },
          ],
        },
      },
    ]);
    const { node } = withQueryAndRouter(<PcapDetailView engagementId="eng-1" pcapId="p1" />);
    render(node);
    expect(await screen.findByTestId("protocol-hierarchy-table")).toBeInTheDocument();
    expect(screen.getByText("eth")).toBeInTheDocument();
    expect(screen.getByText("tcp")).toBeInTheDocument();
  });

  it("renders filter_failed evidence with the failure reason", async () => {
    setAnalysis("partial", { filter_failed: 1 });
    setFindings([
      {
        ...baseFinding,
        kind: "filter_failed",
        severity: "low",
        evidence: { filter_name: "deauth", reason: "tshark timeout after 90s" },
      },
    ]);
    const { node } = withQueryAndRouter(<PcapDetailView engagementId="eng-1" pcapId="p1" />);
    render(node);
    expect(await screen.findByText(/filter failed: deauth/i)).toBeInTheDocument();
    expect(screen.getByText(/tshark timeout/i)).toBeInTheDocument();
  });
});
