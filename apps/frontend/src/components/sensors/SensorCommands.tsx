import { CheckCircle2, CircleAlert, Loader2, RotateCw, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DetailSection } from "@/components/ui/DetailGrid";
import { Input } from "@/components/ui/Input";
import { RelativeTime } from "@/components/domain/RelativeTime";
import {
  type ChannelBand,
  type Sensor,
  useRestartSensor,
  useSetSensorChannel,
  useUpdateSensor,
} from "@/services/api/queries";
import { useLiveTopic } from "@/services/ws/hooks";
import { type OperatorMessage } from "@/services/ws/operator";

const BANDS: ChannelBand[] = ["2.4", "5", "6"];
const FEEDBACK_CAP = 6;

interface CommandResult {
  sensor_id: string;
  command_id: string;
  /** Backend currently emits `restart` / `update` / `set_channel`. */
  command: string;
  /** Backend currently emits `accepted` / `ok` / `failed` / `timeout`. */
  outcome: string;
  started_at?: string;
  finished_at?: string;
  audit_id?: string;
}

function isCommandResult(msg: OperatorMessage): msg is OperatorMessage & CommandResult {
  return (
    msg.kind === "command_result" &&
    typeof (msg as { sensor_id?: unknown }).sensor_id === "string" &&
    typeof (msg as { command_id?: unknown }).command_id === "string" &&
    typeof (msg as { command?: unknown }).command === "string"
  );
}

interface SensorCommandsProps {
  sensor: Sensor;
}

/**
 * Admin-only sensor lifecycle controls.
 *
 * Backend gates these on admin + recent 2FA + CSRF (returns 403 if any
 * is missing); we surface the error inline rather than blowing up the
 * drawer. Each POST is a fire-and-202 — the actual outcome lands later
 * on the operator WebSocket as a `command_result` event keyed to the
 * `command_id` we get back.
 *
 * The recent-feedback panel keeps the last {@link FEEDBACK_CAP} events
 * for this sensor so an operator can scroll a tiny bit of history
 * without leaving the drawer.
 */
export function SensorCommands({ sensor }: SensorCommandsProps): JSX.Element {
  const restart = useRestartSensor();
  const update = useUpdateSensor();
  const setChannel = useSetSensorChannel();

  const [channel, setChannel_] = useState<string>(() =>
    sensor.capabilities?.includes("channel_control") ? "6" : "",
  );
  const [band, setBand] = useState<ChannelBand>("2.4");
  const [pendingChannel, setPendingChannel] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<CommandResult[]>([]);

  useLiveTopic(
    (msg) => msg.kind === "command_result",
    (msg) => {
      if (!isCommandResult(msg)) return;
      if (msg.sensor_id !== sensor.id) return;
      setFeedback((prev) => {
        if (prev.some((p) => p.command_id === msg.command_id)) return prev;
        return [
          {
            sensor_id: msg.sensor_id,
            command_id: msg.command_id,
            command: msg.command,
            outcome: msg.outcome,
            started_at: msg.started_at,
            finished_at: msg.finished_at,
            audit_id: msg.audit_id,
          },
          ...prev,
        ].slice(0, FEEDBACK_CAP);
      });
    },
  );

  // Reset transient state when the operator opens a different sensor.
  useEffect(() => {
    setFeedback([]);
    setPendingChannel(null);
    setChannel_(sensor.capabilities?.includes("channel_control") ? "6" : "");
    setBand("2.4");
  }, [sensor.id, sensor.capabilities]);

  const supportsChannel = (sensor.capabilities ?? []).includes("channel_control");

  const restartError = restart.error;
  const updateError = update.error;
  const channelError = setChannel.error;

  const onSubmitChannel = (e: React.FormEvent): void => {
    e.preventDefault();
    const parsed = Number(channel);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 196) return;
    setPendingChannel(`${parsed}@${band}`);
    setChannel.mutate({ id: sensor.id, channel: parsed, band });
  };

  return (
    <>
      <DetailSection label="Lifecycle commands">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={restart.isPending || sensor.revoked}
              onClick={() => restart.mutate(sensor.id)}
              aria-label="Restart sensor"
            >
              {restart.isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RotateCw className="size-3.5" aria-hidden="true" />
              )}
              Restart
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={update.isPending || sensor.revoked}
              onClick={() => update.mutate(sensor.id)}
              aria-label="Update sensor"
            >
              {update.isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Wand2 className="size-3.5" aria-hidden="true" />
              )}
              Update
            </Button>
          </div>
          <p className="text-2xs text-fg-60">
            Admin + recent 2FA required. Each click queues a command; the result lands below as the
            sensor reports back.
          </p>
          {restart.isSuccess && (
            <AcceptedNote command="Restart" commandId={restart.data?.command_id} />
          )}
          {update.isSuccess && (
            <AcceptedNote command="Update" commandId={update.data?.command_id} />
          )}
          {restartError && <ErrorNote error={restartError.message} />}
          {updateError && <ErrorNote error={updateError.message} />}
        </div>
      </DetailSection>

      <DetailSection label="Set channel">
        {supportsChannel ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={onSubmitChannel}
            data-testid="set-channel-form"
          >
            <label className="flex flex-col gap-1">
              <span className="text-2xs uppercase tracking-wide text-fg-60">Channel</span>
              <Input
                type="number"
                value={channel}
                onChange={(e) => setChannel_(e.target.value)}
                min={1}
                max={196}
                aria-label="Channel"
                className="h-8 w-24"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-2xs uppercase tracking-wide text-fg-60">Band</span>
              <select
                value={band}
                onChange={(e) => setBand(e.target.value as ChannelBand)}
                aria-label="Band"
                className="h-8 rounded-sm border border-fg-20 bg-bg-1 px-2 text-sm"
              >
                {BANDS.map((b) => (
                  <option key={b} value={b}>
                    {b} GHz
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={setChannel.isPending || sensor.revoked || channel === ""}
            >
              {setChannel.isPending ? "Sending…" : "Send"}
            </Button>
            {setChannel.isSuccess && pendingChannel && (
              <AcceptedNote
                command={`Set channel ${pendingChannel.replace("@", " @ ")} GHz`}
                commandId={setChannel.data?.command_id}
              />
            )}
            {channelError && <ErrorNote error={channelError.message} />}
          </form>
        ) : (
          <p className="text-xs text-fg-60">
            This sensor does not advertise the <code>channel_control</code> capability.
          </p>
        )}
      </DetailSection>

      <DetailSection label="Recent command feedback">
        <CommandFeedbackList items={feedback} />
      </DetailSection>
    </>
  );
}

function AcceptedNote({
  command,
  commandId,
}: {
  command: string;
  commandId: string | undefined;
}): JSX.Element {
  return (
    <p className="flex items-center gap-2 text-2xs text-fg-80">
      <CheckCircle2 className="size-3 text-accent-green" aria-hidden="true" />
      <span>
        {command} queued.{" "}
        <span className="font-mono text-fg-60">cmd #{commandId?.slice(0, 8) ?? "?"}</span>
      </span>
    </p>
  );
}

function ErrorNote({ error }: { error: string }): JSX.Element {
  return (
    <p
      role="alert"
      className="flex items-center gap-2 rounded-sm border border-accent-red/40 bg-accent-red/10 px-2 py-1 text-2xs text-accent-red"
    >
      <CircleAlert className="size-3" aria-hidden="true" />
      {error}
    </p>
  );
}

function CommandFeedbackList({ items }: { items: CommandResult[] }): JSX.Element {
  if (items.length === 0) {
    return (
      <p className="text-xs text-fg-60">
        Nothing yet. Command outcomes from the sensor will appear here as they arrive.
      </p>
    );
  }
  return (
    <ul
      data-testid="sensor-command-feedback"
      className="flex flex-col divide-y divide-fg-20 rounded-sm border border-fg-20 bg-bg-inset"
    >
      {items.map((item) => (
        <li key={item.command_id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-2xs">
          <OutcomeBadge outcome={item.outcome} />
          <span className="font-mono text-fg-80">{commandLabel(item.command)}</span>
          <span className="font-mono text-fg-60">#{item.command_id.slice(0, 8)}</span>
          {item.finished_at ? (
            <span className="ml-auto">
              <RelativeTime value={item.finished_at} />
            </span>
          ) : item.started_at ? (
            <span className="ml-auto">
              <RelativeTime value={item.started_at} />
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }): JSX.Element {
  const tone: "green" | "amber" | "red" | "neutral" =
    outcome === "ok" || outcome === "accepted"
      ? "green"
      : outcome === "failed" || outcome === "timeout"
        ? "red"
        : "neutral";
  return (
    <Badge tone={tone} outline>
      {outcome}
    </Badge>
  );
}

function commandLabel(command: string): string {
  return command.replace(/_/g, " ");
}
