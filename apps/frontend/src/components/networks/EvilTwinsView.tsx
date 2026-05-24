import { Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/domain/EmptyState";
import { MacAddress } from "@/components/domain/MacAddress";
import { useEvilTwinCandidates } from "@/services/api/queries";

/**
 * Same-SSID + vendor-mismatch APs flagged by the backend's evil-twin
 * detector (PR #59). Authenticated-operator visible; non-mutating. This
 * is a *defensive* surface — operators read it during an engagement
 * to spot Pineapple-class lookalikes of legitimate networks. There's
 * no action affordance here on purpose; mitigation belongs in the
 * lab/active-modules surface, not the read-only inspection view.
 */
export function EvilTwinsView(): JSX.Element {
  const query = useEvilTwinCandidates({ limit: 200 });
  const [filter, setFilter] = useState("");

  const items = useMemo(() => query.data?.items ?? [], [query.data?.items]);
  const filtered = useMemo(() => {
    if (!filter) return items;
    const lower = filter.toLowerCase();
    return items.filter(
      (c) =>
        c.ssid.toLowerCase().includes(lower) ||
        c.candidates.some((b) => b.toLowerCase().includes(lower)),
    );
  }, [items, filter]);

  if (query.error?.status === 401) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Evil-twin candidates" />
        <EmptyState
          title="Sign in required"
          description="Evil-twin detection requires an authenticated operator session."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Evil-twin candidates"
        total={query.data?.total}
        search={{
          value: filter,
          onChange: setFilter,
          placeholder: "Filter by SSID or BSSID…",
        }}
      >
        <Button asChild variant="ghost" size="sm">
          <Link to="/networks">Back to all APs</Link>
        </Button>
      </PageHeader>

      {query.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={items.length === 0 ? "No candidates detected" : "No matches"}
          description={
            items.length === 0
              ? "When two APs broadcast the same SSID with mismatched vendor OUIs, they'll appear here."
              : "Try a different search term."
          }
        />
      ) : (
        <ul
          className="flex flex-col gap-2"
          data-testid="evil-twin-candidate-list"
          aria-label="Evil-twin candidates"
        >
          {filtered.map((c) => (
            <CandidateCard
              key={c.ssid}
              ssid={c.ssid}
              bssids={c.candidates}
              suspicion={c.suspicion}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface CandidateCardProps {
  ssid: string;
  bssids: string[];
  suspicion: number;
}

function CandidateCard({ ssid, bssids, suspicion }: CandidateCardProps): JSX.Element {
  const suspicionPct = Math.round(suspicion * 100);
  const tone = suspicion >= 0.7 ? "red" : suspicion >= 0.4 ? "amber" : "neutral";
  return (
    <li
      data-testid="evil-twin-candidate"
      data-ssid={ssid}
      className="rounded-md border border-fg-20 bg-bg-2 p-3"
    >
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <ShieldAlert
          className="size-4 text-accent-amber"
          aria-hidden="true"
          data-testid="evil-twin-icon"
        />
        <span className="font-mono text-sm text-fg-100">{ssid}</span>
        <Badge tone={tone} outline data-testid="suspicion-badge">
          {suspicionPct}% suspicion
        </Badge>
        <Badge tone="neutral" outline>
          {bssids.length} candidates
        </Badge>
      </header>
      <div className="flex flex-wrap gap-2 pl-6">
        {bssids.map((bssid) => (
          <MacAddress key={bssid} value={bssid} truncate />
        ))}
      </div>
    </li>
  );
}
