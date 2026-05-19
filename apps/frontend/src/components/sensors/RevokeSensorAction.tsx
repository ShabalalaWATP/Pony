import { CircleAlert, ShieldX } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { DetailSection } from "@/components/ui/DetailGrid";
import { Input } from "@/components/ui/Input";
import { type Sensor, useRevokeSensor } from "@/services/api/queries";

interface RevokeSensorActionProps {
  sensor: Sensor;
}

/**
 * Destructive revoke control inside the sensor detail drawer.
 *
 * The backend tears down the sensor's client certificate; the agent
 * loses gateway access on its next reconnect. We guard the action with
 * a GitHub-style typed-confirm — the operator has to type the sensor's
 * id verbatim before the Revoke button enables. A 403 (admin + recent
 * 2FA missing) surfaces inline instead of blowing up the drawer.
 */
export function RevokeSensorAction({ sensor }: RevokeSensorActionProps): JSX.Element {
  const revoke = useRevokeSensor();
  const [typed, setTyped] = useState("");
  const [confirming, setConfirming] = useState(false);

  if (sensor.revoked) {
    return (
      <DetailSection label="Revoke">
        <p
          data-testid="sensor-already-revoked"
          className="flex items-center gap-2 rounded-sm border border-fg-20 bg-bg-inset px-3 py-2 text-xs text-fg-60"
        >
          <ShieldX className="size-3.5" aria-hidden="true" />
          Already revoked — the sensor cannot reconnect until it&apos;s re-registered.
        </p>
      </DetailSection>
    );
  }

  const matches = typed === sensor.id;
  const canSubmit = matches && !revoke.isPending && !revoke.isSuccess;

  if (!confirming) {
    return (
      <DetailSection label="Revoke">
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={() => setConfirming(true)}
            data-testid="sensor-revoke-open"
          >
            <ShieldX className="size-3.5" aria-hidden="true" />
            Revoke certificate…
          </Button>
          <p className="text-2xs text-fg-60">
            Tears down the sensor&apos;s mTLS material. Use this if the Pi was lost or compromised.
          </p>
        </div>
      </DetailSection>
    );
  }

  if (revoke.isSuccess) {
    return (
      <DetailSection label="Revoke">
        <p
          role="status"
          data-testid="sensor-revoke-success"
          className="flex items-center gap-2 rounded-sm border border-accent-amber/40 bg-accent-amber/10 px-3 py-2 text-xs text-accent-amber"
        >
          <ShieldX className="size-3.5" aria-hidden="true" />
          Revoked. The sensor will drop on its next reconnect.
        </p>
      </DetailSection>
    );
  }

  return (
    <DetailSection label="Revoke">
      <form
        className="flex flex-col gap-2 rounded-md border border-accent-red/40 bg-accent-red/10 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) revoke.mutate(sensor.id);
        }}
        data-testid="sensor-revoke-form"
      >
        <p className="flex items-center gap-2 text-2xs text-accent-red">
          <CircleAlert className="size-3.5" aria-hidden="true" />
          Type <span className="font-mono">{sensor.id}</span> to confirm. This cannot be undone
          without re-registering the sensor.
        </p>
        <Input
          aria-label="Type the sensor ID to confirm revocation"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={sensor.id}
          aria-invalid={typed !== "" && !matches}
          maxLength={64}
          mono
        />
        {revoke.error && (
          <p role="alert" data-testid="sensor-revoke-error" className="text-2xs text-accent-red">
            {revoke.error.status === 403
              ? "Admin role + recent TOTP is required to revoke a sensor."
              : revoke.error.message}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setConfirming(false);
              setTyped("");
              revoke.reset();
            }}
            disabled={revoke.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" variant="danger" size="sm" disabled={!canSubmit}>
            {revoke.isPending ? "Revoking…" : "Revoke certificate"}
          </Button>
        </div>
      </form>
    </DetailSection>
  );
}
