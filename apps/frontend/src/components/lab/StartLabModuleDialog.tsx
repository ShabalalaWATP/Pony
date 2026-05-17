import { AlertTriangle, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { Input } from "@/components/ui/Input";
import { type ApiError } from "@/services/api/client";
import {
  type Engagement,
  type LabModule,
  type LabModuleStartRequest,
  type TargetKind,
  isLabRefusal,
  useStartLabModule,
} from "@/services/api/labQueries";
import { useSensorsList } from "@/services/api/queries";

const TARGET_KINDS: TargetKind[] = ["bssid", "ssid", "client_mac"];

interface StartLabModuleDialogProps {
  module: LabModule | null;
  engagement: Engagement | null;
  onClose: () => void;
  /** Called after a successful 202 so the caller can flash a toast. */
  onAccepted?: (commandId: string) => void;
}

interface FormState {
  sensorId: string;
  targetKind: TargetKind;
  targetValue: string;
  parameters: string;
  confirm: string;
}

const MODULE_LABELS: Record<LabModule, string> = {
  "rogue-ap": "Rogue AP",
  deauth: "Deauthentication",
  "evil-twin": "Evil Twin",
  "captive-portal": "Captive Portal",
  mitm: "MITM Proxy",
};

const MODULE_BLURB: Record<LabModule, string> = {
  "rogue-ap":
    "Spawns a hostapd-mana SSID on the chosen sensor. The captured probe-only frames stay on the engagement audit log.",
  deauth:
    "Sends targeted 802.11 deauth frames at the BSSID/client. High-impact — operators are expected to log a justification per use.",
  "evil-twin":
    "Mirrors an SSID alongside a captive portal. Pairs with the captive-portal module for credential capture.",
  "captive-portal":
    "Stands up a captive web portal on the rogue interface. Templates live in the engagement scope rules.",
  mitm: "Routes client traffic through bettercap's HTTPS proxy. Only fires when the engagement has explicit MITM scope.",
};

/**
 * Type-to-confirm start dialog for a single lab module.
 *
 * Per the design spec §10 destructive actions, this dialog is the only
 * surface that can fire an active module. Three safety affordances:
 *
 * 1. The module + sensor + target are restated verbatim.
 * 2. The operator must type the target value back into a confirm input
 *    (à la GitHub repository delete) before the Start button enables.
 * 3. Backend refusal reasons (`lab_mode_disabled`, `missing_2fa`, …)
 *    surface inline in the dialog so the operator knows exactly which
 *    gate failed without leaving the flow.
 */
export function StartLabModuleDialog({
  module,
  engagement,
  onClose,
  onAccepted,
}: StartLabModuleDialogProps): JSX.Element | null {
  const sensorsQuery = useSensorsList({ limit: 200 });
  const start = useStartLabModule();
  const [state, setState] = useState<FormState>(() => initial());
  const [formError, setFormError] = useState<string | null>(null);

  // Reset state when the dialog opens with a new module.
  useEffect(() => {
    if (!module) return;
    setState(initial());
    setFormError(null);
    start.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start is stable across renders
  }, [module]);

  const sensorOptions = useMemo(
    () => (sensorsQuery.data?.items ?? []).filter((s) => !s.revoked),
    [sensorsQuery.data?.items],
  );
  const confirmReady =
    state.confirm.trim() === state.targetValue.trim() && state.targetValue !== "";
  const canSubmit =
    Boolean(engagement) &&
    Boolean(module) &&
    Boolean(state.sensorId) &&
    state.targetValue.trim().length > 0 &&
    confirmReady &&
    !start.isPending;

  const refusal = start.error ? extractRefusal(start.error) : null;

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    setFormError(null);
    if (!module || !engagement) return;
    let parameters: Record<string, unknown> = {};
    if (state.parameters.trim()) {
      try {
        const parsed: unknown = JSON.parse(state.parameters);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setFormError("Parameters must be a JSON object.");
          return;
        }
        parameters = parsed as Record<string, unknown>;
      } catch {
        setFormError("Parameters are not valid JSON.");
        return;
      }
    }
    const body: LabModuleStartRequest = {
      sensor_id: state.sensorId,
      engagement_id: engagement.id,
      target: { kind: state.targetKind, value: state.targetValue.trim() },
      parameters,
    };
    start.mutate(
      { module, body },
      {
        onSuccess: (data) => {
          onAccepted?.(data.command_id);
          onClose();
        },
      },
    );
  };

  return (
    <Drawer
      open={Boolean(module)}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-accent-violet" aria-hidden="true" />
          <span>
            Fire <strong>{module ? MODULE_LABELS[module] : ""}</strong>
          </span>
        </div>
      }
      width={520}
    >
      {!module ? null : !engagement ? (
        <p className="text-sm text-fg-80">
          No active engagement. Create or resume an engagement before firing modules.
        </p>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={handleSubmit}
          data-testid="start-lab-module-form"
        >
          <p className="rounded-sm border border-accent-amber/40 bg-accent-amber/10 px-3 py-2 text-xs text-accent-amber">
            <AlertTriangle className="mr-1 inline-block size-3" aria-hidden="true" />
            {MODULE_BLURB[module]}
          </p>

          <Field label="Sensor" htmlFor="lab-sensor">
            <select
              id="lab-sensor"
              value={state.sensorId}
              onChange={(e) => setState({ ...state, sensorId: e.target.value })}
              className="h-9 rounded-sm border border-fg-20 bg-bg-1 px-3 text-sm"
            >
              <option value="">— select —</option>
              {sensorOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.tailnet_ip})
                </option>
              ))}
            </select>
            {sensorsQuery.error?.status === 403 && (
              <span className="text-2xs text-accent-amber">
                Sensor inventory requires admin + 2FA — sign in as admin to pick a sensor.
              </span>
            )}
          </Field>

          <Field label="Target kind" htmlFor="lab-target-kind">
            <select
              id="lab-target-kind"
              value={state.targetKind}
              onChange={(e) => setState({ ...state, targetKind: e.target.value as TargetKind })}
              className="h-9 rounded-sm border border-fg-20 bg-bg-1 px-3 text-sm"
            >
              {TARGET_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </Field>

          <Field label={`Target ${state.targetKind.replace(/_/g, " ")}`} htmlFor="lab-target-value">
            <Input
              id="lab-target-value"
              mono
              value={state.targetValue}
              onChange={(e) => setState({ ...state, targetValue: e.target.value })}
              placeholder={
                state.targetKind === "bssid"
                  ? "aa:bb:cc:dd:ee:01"
                  : state.targetKind === "client_mac"
                    ? "11:22:33:44:55:66"
                    : "SSID-Name"
              }
            />
            <span className="text-2xs text-fg-60">
              Target must already be on the engagement allow-list. Add it from the engagement panel
              first.
            </span>
          </Field>

          <Field label="Parameters (JSON, optional)" htmlFor="lab-parameters">
            <textarea
              id="lab-parameters"
              rows={4}
              value={state.parameters}
              onChange={(e) => setState({ ...state, parameters: e.target.value })}
              className="w-full rounded-sm border border-fg-20 bg-bg-inset p-2 font-mono text-2xs text-fg-100"
              placeholder='{ "channel": 6 }'
              spellCheck={false}
            />
          </Field>

          <ConfirmField
            target={state.targetValue}
            confirm={state.confirm}
            onChange={(v) => setState({ ...state, confirm: v })}
          />

          {formError && (
            <p role="alert" className="text-2xs text-accent-red">
              {formError}
            </p>
          )}
          {refusal && <RefusalNote refusal={refusal} />}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={start.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={!canSubmit}>
              {start.isPending ? "Firing…" : `Fire ${module ? MODULE_LABELS[module] : ""}`}
            </Button>
          </div>
        </form>
      )}
    </Drawer>
  );
}

function initial(): FormState {
  return {
    sensorId: "",
    targetKind: "bssid",
    targetValue: "",
    parameters: "",
    confirm: "",
  };
}

interface ConfirmFieldProps {
  target: string;
  confirm: string;
  onChange: (next: string) => void;
}
function ConfirmField({ target, confirm, onChange }: ConfirmFieldProps): JSX.Element {
  const ready = target !== "" && confirm.trim() === target.trim();
  return (
    <Field label="Type the target to confirm" htmlFor="lab-confirm">
      <Input
        id="lab-confirm"
        mono
        value={confirm}
        onChange={(e) => onChange(e.target.value)}
        placeholder={target || "Enter target above first"}
        disabled={!target}
        aria-invalid={target !== "" && !ready}
      />
      <span
        className={
          target === ""
            ? "text-2xs text-fg-60"
            : ready
              ? "text-2xs text-accent-green"
              : "text-2xs text-accent-amber"
        }
      >
        {target === ""
          ? "The Fire button stays disabled until you enter and re-type the target value."
          : ready
            ? "Target confirmed."
            : "Type the exact target value to enable the Fire button."}
      </span>
    </Field>
  );
}

function RefusalNote({ refusal }: { refusal: ReturnType<typeof extractRefusal> }): JSX.Element {
  if (!refusal) return <></>;
  return (
    <div
      role="alert"
      data-testid="lab-refusal"
      className="flex flex-col gap-1 rounded-sm border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-xs text-accent-red"
    >
      <span className="font-medium uppercase tracking-wide">
        Refused: {refusal.reason.replace(/_/g, " ")}
      </span>
      <span className="text-fg-80">{refusal.detail}</span>
    </div>
  );
}

function extractRefusal(err: ApiError): { reason: string; detail: string } | null {
  if (err.status !== 403) return null;
  if (isLabRefusal(err.body)) return err.body;
  return { reason: "unknown", detail: err.message };
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1.5">
      <span className="text-2xs uppercase tracking-wide text-fg-60">{label}</span>
      {children}
    </label>
  );
}
