import { Activity, StopCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/domain/EmptyState";
import { LiveDot } from "@/components/domain/LiveDot";
import { RelativeTime } from "@/components/domain/RelativeTime";
import {
  type LabActiveCommand,
  type LabModule,
  useActiveLabCommands,
  useStopLabModule,
} from "@/services/api/labQueries";
import { useLiveTopic, useOperatorConnection } from "@/services/ws/hooks";
import { type OperatorMessage } from "@/services/ws/operator";
import { cn } from "@/lib/cn";

interface ProgressEntry {
  status?: string;
  message?: string;
  updated_at: number;
}

function progressMessage(msg: OperatorMessage): { command_id?: string; entry?: ProgressEntry } {
  const cid = (msg as { command_id?: unknown }).command_id;
  if (typeof cid !== "string") return {};
  const status = (msg as { status?: unknown }).status;
  const message = (msg as { message?: unknown }).message;
  return {
    command_id: cid,
    entry: {
      status: typeof status === "string" ? status : undefined,
      message: typeof message === "string" ? message : undefined,
      updated_at: Date.now(),
    },
  };
}

/**
 * Active lab commands panel.
 *
 * Seeds from `GET /lab/active`, listens for `lab.started` /
 * `lab.progress` / `lab.stopped` topics on the operator WS to keep
 * each row up to date without thrashing the network. Stop button hits
 * `POST /lab/{module}/stop/{command_id}` and the list refreshes from
 * the resulting `lab.stopped` event.
 */
export function ActiveLabCommandsList(): JSX.Element {
  const { state } = useOperatorConnection();
  const query = useActiveLabCommands();
  const stop = useStopLabModule();
  const [progress, setProgress] = useState<Record<string, ProgressEntry>>({});

  // Live progress updates are kept locally — the list itself is
  // re-queried by useOperatorCacheInvalidations() on lab.started /
  // lab.stopped, so we don't replay those into local state.
  useLiveTopic("lab.progress", (msg) => {
    const { command_id, entry } = progressMessage(msg);
    if (!command_id || !entry) return;
    setProgress((prev) => ({ ...prev, [command_id]: entry }));
  });
  // Drop progress for stopped commands so the map doesn't grow forever.
  useLiveTopic("lab.stopped", (msg) => {
    const cid = (msg as { command_id?: unknown }).command_id;
    if (typeof cid !== "string") return;
    setProgress((prev) => {
      if (!(cid in prev)) return prev;
      const next = { ...prev };
      delete next[cid];
      return next;
    });
  });

  const items = useMemo(() => query.data?.items ?? [], [query.data?.items]);

  // Reset progress entries for commands that left the list.
  useEffect(() => {
    setProgress((prev) => {
      const ids = new Set(items.map((i) => i.command_id));
      let dirty = false;
      const next: Record<string, ProgressEntry> = {};
      for (const [id, entry] of Object.entries(prev)) {
        if (ids.has(id)) next[id] = entry;
        else dirty = true;
      }
      return dirty ? next : prev;
    });
  }, [items]);

  const liveState: "live" | "stale" | "offline" =
    state === "open" ? "live" : state === "connecting" ? "stale" : "offline";

  return (
    <section
      data-testid="active-lab-commands"
      className="overflow-hidden rounded-md border border-fg-20 bg-bg-2"
    >
      <header className="flex items-center justify-between border-b border-fg-20 px-4 py-2.5">
        <div className="flex items-center gap-2 text-2xs uppercase tracking-wide text-fg-60">
          <Activity className="size-3" aria-hidden="true" />
          Active commands
          <Badge tone="neutral" outline>
            {query.data?.total ?? 0}
          </Badge>
        </div>
        <LiveDot state={liveState} />
      </header>
      {query.error?.status === 401 || query.error?.status === 403 ? (
        <EmptyState
          title="Sign in required"
          description="The active-command stream is gated on an authenticated session."
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="No active commands"
          description="Fire a module from one of the cards above and the live stream will land here."
        />
      ) : (
        <ul className="divide-y divide-fg-20">
          {items.map((c) => (
            <CommandRow
              key={c.command_id}
              command={c}
              progress={progress[c.command_id]}
              busyStop={stop.isPending && stop.variables?.commandId === c.command_id}
              onStop={(module) => stop.mutate({ module, commandId: c.command_id })}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface CommandRowProps {
  command: LabActiveCommand;
  progress: ProgressEntry | undefined;
  busyStop: boolean;
  onStop: (module: LabModule) => void;
}

function CommandRow({ command, progress, busyStop, onStop }: CommandRowProps): JSX.Element {
  const fresh = progress ? Date.now() - progress.updated_at < 1500 : false;
  return (
    <li
      className={cn(
        "relative flex flex-wrap items-center gap-3 px-4 py-2 text-xs",
        fresh && "cp-fresh",
      )}
    >
      <Badge tone="violet" outline>
        {command.module}
      </Badge>
      <span className="font-mono text-fg-100">{command.target.value}</span>
      <span className="font-mono text-2xs text-fg-60">({command.target.kind})</span>
      <span className="text-2xs text-fg-60">sensor {command.sensor_id.slice(0, 8)}</span>
      <RelativeTime value={command.started_at} />
      {progress && (
        <span className="font-mono text-2xs text-fg-80">
          {progress.status ?? "progress"}
          {progress.message ? `: ${progress.message}` : ""}
        </span>
      )}
      <span className="ml-auto font-mono text-2xs text-fg-60">
        cmd #{command.command_id.slice(0, 8)}
      </span>
      <Button
        variant="ghost"
        size="sm"
        disabled={busyStop}
        onClick={() => onStop(command.module)}
        aria-label={`Stop ${command.module} ${command.command_id}`}
      >
        <StopCircle className="size-3.5" aria-hidden="true" />
        {busyStop ? "Stopping…" : "Stop"}
      </Button>
    </li>
  );
}
