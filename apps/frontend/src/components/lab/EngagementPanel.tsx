import { CheckCircle2, ShieldX, StopCircle } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { RelativeTime } from "@/components/domain/RelativeTime";
import {
  type Engagement,
  type TargetKind,
  useAddAllowListTarget,
  useEndEngagement,
} from "@/services/api/labQueries";

const TARGET_KINDS: TargetKind[] = ["bssid", "ssid", "client_mac"];

interface EngagementPanelProps {
  engagement: Engagement;
}

/**
 * Active-engagement summary panel.
 *
 * Surfaces the engagement name and start time, lets an admin add a
 * target to the allow-list (POST 204 → success badge), and ends the
 * engagement with a typed-confirm safety check. The allow-list itself
 * isn't readable from the backend — the API only accepts additions
 * (matches the brief's M3 contract). Adds therefore show success state
 * rather than rendering a list.
 */
export function EngagementPanel({ engagement }: EngagementPanelProps): JSX.Element {
  const allow = useAddAllowListTarget();
  const end = useEndEngagement();
  const [kind, setKind] = useState<TargetKind>("bssid");
  const [value, setValue] = useState("");
  const [endConfirm, setEndConfirm] = useState("");

  const handleAllow = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!value.trim()) return;
    allow.mutate(
      { engagementId: engagement.id, payload: { kind, value: value.trim() } },
      { onSuccess: () => setValue("") },
    );
  };
  const endReady = endConfirm.trim() === engagement.name.trim();
  const handleEnd = (): void => {
    if (!endReady || end.isPending) return;
    end.mutate(engagement.id);
  };

  return (
    <section
      data-testid="engagement-panel"
      className="rounded-md border border-mode/40 bg-mode/5 p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone="accent" outline>
          Active engagement
        </Badge>
        <span className="text-sm font-medium text-fg-100">{engagement.name}</span>
        {engagement.started_at && (
          <span className="text-2xs text-fg-60">
            started <RelativeTime value={engagement.started_at} />
          </span>
        )}
        <span className="ml-auto font-mono text-2xs text-fg-60">id: {engagement.id}</span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <form className="flex flex-col gap-2" onSubmit={handleAllow}>
          <label className="text-2xs uppercase tracking-wide text-fg-60">
            Add allow-list target
          </label>
          <div className="flex gap-2">
            <select
              aria-label="Target kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as TargetKind)}
              className="h-9 rounded-sm border border-fg-20 bg-bg-1 px-2 text-sm"
            >
              {TARGET_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <Input
              mono
              aria-label="Target value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={kind === "ssid" ? "SSID-Name" : "aa:bb:cc:dd:ee:01"}
              className="flex-1"
            />
            <Button type="submit" variant="secondary" disabled={allow.isPending || !value.trim()}>
              {allow.isPending ? "Adding…" : "Allow"}
            </Button>
          </div>
          {allow.isSuccess && (
            <p className="flex items-center gap-1 text-2xs text-accent-green">
              <CheckCircle2 className="size-3" aria-hidden="true" /> Target added.
            </p>
          )}
          {allow.error && (
            <p role="alert" className="text-2xs text-accent-red">
              {allow.error.message}
            </p>
          )}
        </form>

        <div className="flex flex-col gap-2">
          <label className="text-2xs uppercase tracking-wide text-fg-60">
            End engagement (type the name)
          </label>
          <div className="flex gap-2">
            <Input
              aria-label="Engagement name to confirm"
              value={endConfirm}
              onChange={(e) => setEndConfirm(e.target.value)}
              placeholder={engagement.name}
              className="flex-1"
            />
            <Button
              type="button"
              variant="danger"
              onClick={handleEnd}
              disabled={!endReady || end.isPending}
              aria-label="End engagement"
            >
              <StopCircle className="size-3.5" aria-hidden="true" />
              {end.isPending ? "Ending…" : "End"}
            </Button>
          </div>
          {end.error && (
            <p role="alert" className="text-2xs text-accent-red">
              <ShieldX className="mr-1 inline size-3" aria-hidden="true" />
              {end.error.message}
            </p>
          )}
          <p className="text-2xs text-fg-60">
            Ending an engagement cancels every active lab command scoped to it and is recorded in
            the immutable audit log.
          </p>
        </div>
      </div>
    </section>
  );
}
