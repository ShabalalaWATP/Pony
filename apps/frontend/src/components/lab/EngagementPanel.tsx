import { CheckCircle2, ShieldX, StopCircle, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CornerBrackets } from "@/components/ui/CornerBrackets";
import { EndpointHint } from "@/components/ui/EndpointHint";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { RelativeTime } from "@/components/domain/RelativeTime";
import {
  type AllowedTarget,
  type Engagement,
  type TargetKind,
  useAddAllowListTarget,
  useAllowList,
  useEndEngagement,
  useRemoveAllowListTarget,
} from "@/services/api/labQueries";

const TARGET_KINDS: TargetKind[] = ["bssid", "ssid", "client_mac"];

interface EngagementPanelProps {
  engagement: Engagement;
}

/**
 * Active-engagement summary panel.
 *
 * Renders the engagement name + start time, the live allow-list (with
 * per-row remove buttons), and an admin-only end action behind a
 * typed-confirm. The allow-list reads from
 * `GET /engagements/{id}/allow-list` so the operator sees what's
 * already on file rather than just blind-POSTing additions.
 */
export function EngagementPanel({ engagement }: EngagementPanelProps): JSX.Element {
  const allowList = useAllowList(engagement.id);
  const add = useAddAllowListTarget();
  const remove = useRemoveAllowListTarget();
  const end = useEndEngagement();
  const [kind, setKind] = useState<TargetKind>("bssid");
  const [value, setValue] = useState("");
  const [endConfirm, setEndConfirm] = useState("");

  const handleAdd = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!value.trim()) return;
    add.mutate(
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
      className="relative rounded-md border border-mode/40 bg-mode/5 p-4"
    >
      <CornerBrackets inset="-0.4rem" tone="mode" />
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
        <EndpointHint className="ml-auto">{`/api/v1/engagements/${engagement.id}`}</EndpointHint>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <AllowListSection
          engagementId={engagement.id}
          allowList={allowList}
          kind={kind}
          value={value}
          onKindChange={setKind}
          onValueChange={setValue}
          onSubmit={handleAdd}
          addBusy={add.isPending}
          addSuccess={add.isSuccess && !add.isPending}
          addError={add.error?.message}
          remove={remove}
        />

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

interface AllowListSectionProps {
  engagementId: string;
  allowList: ReturnType<typeof useAllowList>;
  kind: TargetKind;
  value: string;
  onKindChange: (k: TargetKind) => void;
  onValueChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  addBusy: boolean;
  addSuccess: boolean;
  addError: string | undefined;
  remove: ReturnType<typeof useRemoveAllowListTarget>;
}

function AllowListSection({
  engagementId,
  allowList,
  kind,
  value,
  onKindChange,
  onValueChange,
  onSubmit,
  addBusy,
  addSuccess,
  addError,
  remove,
}: AllowListSectionProps): JSX.Element {
  const items = allowList.data?.items ?? [];
  return (
    <form className="flex flex-col gap-2" onSubmit={onSubmit}>
      <label className="text-2xs uppercase tracking-wide text-fg-60">Allow-list</label>
      <div className="flex gap-2">
        <select
          aria-label="Target kind"
          value={kind}
          onChange={(e) => onKindChange(e.target.value as TargetKind)}
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
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={kind === "ssid" ? "SSID-Name" : "aa:bb:cc:dd:ee:01"}
          className="flex-1"
        />
        <Button type="submit" variant="secondary" disabled={addBusy || !value.trim()}>
          {addBusy ? "Adding…" : "Allow"}
        </Button>
      </div>
      {addSuccess && (
        <p className="flex items-center gap-1 text-2xs text-accent-green">
          <CheckCircle2 className="size-3" aria-hidden="true" /> Target added.
        </p>
      )}
      {addError && (
        <p role="alert" className="text-2xs text-accent-red">
          {addError}
        </p>
      )}
      <AllowListItems
        engagementId={engagementId}
        items={items}
        loading={allowList.isLoading}
        error={allowList.error?.message}
        remove={remove}
      />
    </form>
  );
}

interface AllowListItemsProps {
  engagementId: string;
  items: AllowedTarget[];
  loading: boolean;
  error: string | undefined;
  remove: ReturnType<typeof useRemoveAllowListTarget>;
}

function AllowListItems({
  engagementId,
  items,
  loading,
  error,
  remove,
}: AllowListItemsProps): JSX.Element {
  if (loading) {
    return (
      <div className="flex flex-col gap-1.5" data-testid="allow-list-loading">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <p role="alert" className="text-2xs text-accent-red">
        Unable to load allow-list: {error}
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <p className="text-2xs text-fg-60">
        Allow-list is empty — add a target above before firing any module.
      </p>
    );
  }
  return (
    <ul
      data-testid="allow-list"
      className="flex flex-col divide-y divide-fg-20 rounded-sm border border-fg-20 bg-bg-inset"
    >
      {items.map((t) => {
        const pending =
          remove.isPending &&
          remove.variables?.payload.kind === t.kind &&
          remove.variables.payload.value === t.value;
        return (
          <li
            key={`${t.kind}:${t.value}`}
            data-testid="lab-allow-list-row"
            className="flex items-center gap-2 px-2 py-1.5 text-xs"
          >
            <Badge tone="neutral" outline>
              {t.kind.replace(/_/g, " ")}
            </Badge>
            <span className="font-mono text-fg-100">{t.value}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() =>
                remove.mutate({
                  engagementId,
                  payload: { kind: t.kind, value: t.value },
                })
              }
              className="ml-auto"
              aria-label={`Remove ${t.kind} ${t.value}`}
            >
              <Trash2 className="size-3 text-accent-red" aria-hidden="true" />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
