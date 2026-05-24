import { AlertOctagon } from "lucide-react";
import { MacAddress } from "@/components/domain/MacAddress";
import { SsidLabel } from "@/components/domain/SsidLabel";
import type { components } from "@/services/api/openapi";

type Evidence = components["schemas"]["Finding"]["evidence"];

interface FindingEvidenceProps {
  kind: components["schemas"]["FindingKind"];
  evidence: Evidence;
}

/**
 * Per-finding-kind evidence renderer. Dispatches to a focused
 * component per `FindingKind` so each renderer stays presentational
 * and ≤ 60 LOC. Adding a new kind = adding a case + a renderer.
 * The shapes themselves are fully typed from the OpenAPI union.
 */
export function FindingEvidence({ kind, evidence }: FindingEvidenceProps): JSX.Element {
  switch (kind) {
    case "protocol_hierarchy":
      return (
        <ProtocolHierarchy ev={evidence as components["schemas"]["ProtocolHierarchyEvidence"]} />
      );
    case "conversations":
      return <Conversations ev={evidence as components["schemas"]["ConversationsEvidence"]} />;
    case "deauth_bursts":
      return <DeauthBursts ev={evidence as components["schemas"]["DeauthBurstsEvidence"]} />;
    case "eapol_handshakes":
      return <EapolHandshakes ev={evidence as components["schemas"]["EapolHandshakesEvidence"]} />;
    case "beacons":
      return <Beacons ev={evidence as components["schemas"]["BeaconsEvidence"]} />;
    case "probe_response_anomalies":
      return (
        <ProbeAnomalies ev={evidence as components["schemas"]["ProbeResponseAnomaliesEvidence"]} />
      );
    case "dns_summary":
      return <DnsSummary ev={evidence as components["schemas"]["DnsSummaryEvidence"]} />;
    case "tls_sni_summary":
      return <TlsSniSummary ev={evidence as components["schemas"]["TlsSniSummaryEvidence"]} />;
    case "dhcp_hostnames":
      return <DhcpHostnames ev={evidence as components["schemas"]["DhcpHostnamesEvidence"]} />;
    case "filter_failed":
      return <FailedFinding ev={evidence as components["schemas"]["FailedFindingEvidence"]} />;
    default:
      return <UnknownKind kind={kind} />;
  }
}

function ProtocolHierarchy({
  ev,
}: {
  ev: components["schemas"]["ProtocolHierarchyEvidence"];
}): JSX.Element {
  const protos = ev.protocols ?? [];
  if (protos.length === 0) return <Muted>No protocol breakdown.</Muted>;
  return (
    <Table headers={["Protocol", "Frames", "Bytes"]} testId="protocol-hierarchy-table">
      {protos.map((p, i) => (
        <tr key={`${p.depth}-${p.protocol}-${i}`} className="border-t border-fg-20">
          <Td indent={p.depth} className="font-mono text-xs">
            {p.protocol}
          </Td>
          <Td className="tabular-nums">{p.frames.toLocaleString()}</Td>
          <Td className="tabular-nums">{formatBytes(p.bytes)}</Td>
        </tr>
      ))}
    </Table>
  );
}

function Conversations({
  ev,
}: {
  ev: components["schemas"]["ConversationsEvidence"];
}): JSX.Element {
  const convs = ev.conversations ?? [];
  if (convs.length === 0) return <Muted>No conversations.</Muted>;
  return (
    <Table headers={["Left", "Right", "Frames", "Bytes"]} testId="conversations-table">
      {convs.map((c, i) => (
        <tr key={`${c.left}-${c.right}-${i}`} className="border-t border-fg-20">
          <Td>
            <MacOrText value={c.left} />
          </Td>
          <Td>
            <MacOrText value={c.right} />
          </Td>
          <Td className="tabular-nums">{c.frames.toLocaleString()}</Td>
          <Td className="tabular-nums">{formatBytes(c.bytes)}</Td>
        </tr>
      ))}
    </Table>
  );
}

function DeauthBursts({ ev }: { ev: components["schemas"]["DeauthBurstsEvidence"] }): JSX.Element {
  const bursts = ev.bursts ?? [];
  if (bursts.length === 0) {
    return <Muted>No deauth bursts above the threshold ({ev.threshold} frames / 5 min).</Muted>;
  }
  return (
    <Table headers={["BSSID", "Count", "First seen", "Last seen"]} testId="deauth-bursts-table">
      {bursts.map((b, i) => (
        <tr key={`${b.bssid}-${i}`} className="border-t border-fg-20">
          <Td>
            <MacAddress value={b.bssid} truncate />
          </Td>
          <Td className="tabular-nums">{b.count}</Td>
          <Td className="font-mono text-2xs">{formatEpoch(b.first_seen_epoch)}</Td>
          <Td className="font-mono text-2xs">{formatEpoch(b.last_seen_epoch)}</Td>
        </tr>
      ))}
    </Table>
  );
}

function EapolHandshakes({
  ev,
}: {
  ev: components["schemas"]["EapolHandshakesEvidence"];
}): JSX.Element {
  const hs = ev.handshakes ?? [];
  if (hs.length === 0) return <Muted>No EAPOL handshakes captured.</Muted>;
  return (
    <Table headers={["BSSID", "Client", "Messages", "Complete"]} testId="eapol-handshakes-table">
      {hs.map((h, i) => (
        <tr key={`${h.bssid}-${h.client_mac}-${i}`} className="border-t border-fg-20">
          <Td>
            <MacAddress value={h.bssid} truncate />
          </Td>
          <Td>
            <MacAddress value={h.client_mac} truncate />
          </Td>
          <Td className="tabular-nums">{h.message_count}</Td>
          <Td>{h.complete ? "yes" : "no"}</Td>
        </tr>
      ))}
    </Table>
  );
}

function Beacons({ ev }: { ev: components["schemas"]["BeaconsEvidence"] }): JSX.Element {
  const nets = ev.networks ?? [];
  if (nets.length === 0) return <Muted>No beacon networks observed.</Muted>;
  return (
    <Table
      headers={["BSSID", "SSID", "Channel", "Beacon TU", "Capabilities"]}
      testId="beacons-table"
    >
      {nets.map((n, i) => (
        <tr key={`${n.bssid}-${i}`} className="border-t border-fg-20">
          <Td>
            <MacAddress value={n.bssid} truncate />
          </Td>
          <Td className="font-mono text-xs">
            <SsidLabel ssid={n.ssid} />
          </Td>
          <Td className="tabular-nums">{n.channel ?? "—"}</Td>
          <Td className="tabular-nums">{n.beacon_interval_tu ?? "—"}</Td>
          <Td className="text-2xs text-fg-60">{(n.capabilities ?? []).join(", ") || "—"}</Td>
        </tr>
      ))}
    </Table>
  );
}

function ProbeAnomalies({
  ev,
}: {
  ev: components["schemas"]["ProbeResponseAnomaliesEvidence"];
}): JSX.Element {
  const items = ev.anomalies ?? [];
  if (items.length === 0) return <Muted>No probe-response anomalies.</Muted>;
  return (
    <ul className="flex flex-col gap-2" data-testid="probe-anomalies-list">
      {items.map((a, i) => (
        <li
          key={`${a.bssid}-${i}`}
          className="rounded-sm border border-accent-red/40 bg-accent-red/5 px-3 py-2 text-xs"
        >
          <div className="flex items-center gap-2 text-accent-red">
            <AlertOctagon className="size-3" aria-hidden="true" />
            <MacAddress value={a.bssid} truncate />
          </div>
          <div className="mt-1 text-fg-80">
            Beaconed:{" "}
            <span className="font-mono">{(a.beaconed_ssids ?? []).join(", ") || "none"}</span>
          </div>
          <div className="text-fg-80">
            Responded to: <span className="font-mono">{(a.anomalous_ssids ?? []).join(", ")}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function DnsSummary({ ev }: { ev: components["schemas"]["DnsSummaryEvidence"] }): JSX.Element {
  const top = ev.top_queries ?? [];
  if (top.length === 0) return <Muted>No DNS queries observed.</Muted>;
  return (
    <Table headers={["Query", "Count"]} testId="dns-summary-table">
      {top.map((q, i) => (
        <tr key={`${q.name}-${i}`} className="border-t border-fg-20">
          <Td className="font-mono text-xs">{q.name}</Td>
          <Td className="tabular-nums">{q.count}</Td>
        </tr>
      ))}
    </Table>
  );
}

function TlsSniSummary({
  ev,
}: {
  ev: components["schemas"]["TlsSniSummaryEvidence"];
}): JSX.Element {
  const snis = ev.top_snis ?? [];
  if (snis.length === 0) return <Muted>No TLS SNIs observed.</Muted>;
  return (
    <Table headers={["SNI", "Count"]} testId="tls-sni-table">
      {snis.map((s, i) => (
        <tr key={`${s.name}-${i}`} className="border-t border-fg-20">
          <Td className="font-mono text-xs">{s.name}</Td>
          <Td className="tabular-nums">{s.count}</Td>
        </tr>
      ))}
    </Table>
  );
}

function DhcpHostnames({
  ev,
}: {
  ev: components["schemas"]["DhcpHostnamesEvidence"];
}): JSX.Element {
  const clients = ev.clients ?? [];
  if (clients.length === 0) return <Muted>No DHCP hostnames observed.</Muted>;
  return (
    <Table headers={["Client MAC", "Hostname", "Vendor class"]} testId="dhcp-hostnames-table">
      {clients.map((c, i) => (
        <tr key={`${c.client_mac}-${i}`} className="border-t border-fg-20">
          <Td>
            <MacAddress value={c.client_mac} truncate />
          </Td>
          <Td className="font-mono text-xs">{c.hostname ?? "—"}</Td>
          <Td className="font-mono text-2xs text-fg-60">{c.vendor ?? c.vendor_class_id ?? "—"}</Td>
        </tr>
      ))}
    </Table>
  );
}

function FailedFinding({
  ev,
}: {
  ev: components["schemas"]["FailedFindingEvidence"];
}): JSX.Element {
  return (
    <div className="rounded-sm border border-accent-red/40 bg-accent-red/10 p-3 text-xs text-accent-red">
      <div className="flex items-center gap-2">
        <AlertOctagon className="size-3.5" aria-hidden="true" />
        <span className="font-medium">Filter failed: {ev.filter_name}</span>
      </div>
      <div className="mt-1 text-fg-80">{ev.reason}</div>
    </div>
  );
}

function UnknownKind({ kind }: { kind: string }): JSX.Element {
  return <Muted>Unsupported finding kind: {kind}</Muted>;
}

interface TableProps {
  headers: string[];
  testId?: string;
  children: React.ReactNode;
}

function Table({ headers, testId, children }: TableProps): JSX.Element {
  return (
    <div className="overflow-x-auto rounded-sm border border-fg-20">
      <table className="w-full text-left text-xs text-fg-80" data-testid={testId}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                className="bg-bg-2 px-2 py-1.5 text-2xs uppercase tracking-wide text-fg-60"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Td({
  children,
  className,
  indent,
}: {
  children: React.ReactNode;
  className?: string;
  indent?: number;
}): JSX.Element {
  return (
    <td
      className={`px-2 py-1 ${className ?? ""}`}
      style={indent ? { paddingLeft: `${0.5 + indent * 0.75}rem` } : undefined}
    >
      {children}
    </td>
  );
}

function MacOrText({ value }: { value: string }): JSX.Element {
  const looksLikeMac = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/.test(value);
  return looksLikeMac ? (
    <MacAddress value={value} truncate />
  ) : (
    <span className="font-mono text-xs">{value}</span>
  );
}

function Muted({ children }: { children: React.ReactNode }): JSX.Element {
  return <p className="text-xs text-fg-60">{children}</p>;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}

function formatEpoch(epoch: number): string {
  const d = new Date(epoch * 1000);
  return d.toISOString().replace("T", " ").slice(0, 19);
}
