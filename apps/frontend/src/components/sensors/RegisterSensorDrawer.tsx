import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { Input } from "@/components/ui/Input";
import {
  type SensorCapability,
  type SensorRegisterRequest,
  type SensorRegisterResponse,
  useRegisterSensor,
} from "@/services/api/queries";

const ALL_CAPABILITIES: SensorCapability[] = [
  "passive_capture",
  "channel_control",
  "active_modules",
  "rogue_ap",
  "deauth",
  "evil_twin",
  "captive_portal",
  "mitm",
  "geo",
];

interface RegisterSensorDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Fires once registration is confirmed so the parent can toast. */
  onRegistered?: (response: SensorRegisterResponse) => void;
}

/**
 * Register-a-sensor drawer. Backed by `POST /api/v1/sensors`.
 *
 * The endpoint mints a fresh client certificate + private key pair on
 * the backend and returns the PEM material in the response body. We
 * surface the secret material once in this drawer, keep it in memory
 * only (never localStorage / sessionStorage / a URL search param), and
 * clear it the moment the drawer closes — operators must copy or
 * download before they dismiss. Admin + recent 2FA is enforced
 * server-side; a 403 surfaces inline.
 */
export function RegisterSensorDrawer({
  open,
  onClose,
  onRegistered,
}: RegisterSensorDrawerProps): JSX.Element {
  const register = useRegisterSensor();
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [tailnetIp, setTailnetIp] = useState("");
  const [version, setVersion] = useState("");
  const [capabilities, setCapabilities] = useState<Set<SensorCapability>>(
    () => new Set(["passive_capture"]),
  );

  // The cert payload lives only as long as the drawer is open. Closing
  // wipes it, so re-opening after a successful registration starts
  // fresh — there's no way to re-reveal a previous secret.
  useEffect(() => {
    if (open) return;
    setId("");
    setName("");
    setTailnetIp("");
    setVersion("");
    setCapabilities(new Set(["passive_capture"]));
    register.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- register is stable
  }, [open]);

  const trimmedId = id.trim();
  const trimmedName = name.trim();
  const trimmedIp = tailnetIp.trim();
  const trimmedVersion = version.trim();
  const canSubmit =
    trimmedId.length > 0 &&
    trimmedName.length > 0 &&
    trimmedIp.length > 0 &&
    trimmedVersion.length > 0 &&
    !register.isPending &&
    !register.data;

  const toggleCapability = (cap: SensorCapability): void => {
    setCapabilities((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) next.delete(cap);
      else next.add(cap);
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!canSubmit) return;
    const body: SensorRegisterRequest = {
      id: trimmedId,
      name: trimmedName,
      tailnet_ip: trimmedIp,
      version: trimmedVersion,
      capabilities: capabilities.size > 0 ? Array.from(capabilities) : undefined,
    };
    register.mutate(body, {
      onSuccess: (response) => {
        onRegistered?.(response);
      },
    });
  };

  const errorMessage =
    register.error &&
    (register.error.status === 403
      ? "Admin role + recent TOTP is required to register a sensor."
      : register.error.message);

  return (
    <Drawer open={open} onClose={onClose} title="Register sensor" width={560}>
      {register.data ? (
        <CertReveal response={register.data} onClose={onClose} />
      ) : (
        <form
          className="flex flex-col gap-5"
          onSubmit={handleSubmit}
          data-testid="register-sensor-form"
        >
          <Field label="Sensor ID" htmlFor="sensor-id">
            <Input
              id="sensor-id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="pi-attic-01"
              required
              autoFocus
              maxLength={64}
              mono
            />
            <span className="text-2xs text-fg-60">
              Stable identifier the sensor reports back in every event. Lowercase, no spaces.
            </span>
          </Field>

          <Field label="Display name" htmlFor="sensor-name">
            <Input
              id="sensor-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Attic Pi"
              required
              maxLength={120}
            />
          </Field>

          <Field label="Tailnet IP" htmlFor="sensor-ip">
            <Input
              id="sensor-ip"
              value={tailnetIp}
              onChange={(e) => setTailnetIp(e.target.value)}
              placeholder="100.64.0.12"
              required
              maxLength={45}
              mono
            />
            <span className="text-2xs text-fg-60">
              The private tailnet address the backend will reach over the WireGuard tunnel.
            </span>
          </Field>

          <Field label="Agent version" htmlFor="sensor-version">
            <Input
              id="sensor-version"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="0.1.0"
              required
              maxLength={32}
              mono
            />
          </Field>

          <section className="flex flex-col gap-2">
            <header className="text-2xs uppercase tracking-wide text-fg-60">Capabilities</header>
            <ul
              data-testid="sensor-capabilities"
              className="grid grid-cols-2 gap-1.5 rounded-sm border border-fg-20 bg-bg-inset p-2"
            >
              {ALL_CAPABILITIES.map((cap) => {
                const checked = capabilities.has(cap);
                return (
                  <li key={cap}>
                    <label className="flex items-center gap-2 text-xs text-fg-100">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCapability(cap)}
                        aria-label={cap.replace(/_/g, " ")}
                        className="size-3.5 accent-mode"
                      />
                      <span className="font-mono">{cap.replace(/_/g, " ")}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <span className="text-2xs text-fg-60">
              Tick only what this sensor actually supports — the backend refuses commands the sensor
              didn&apos;t advertise.
            </span>
          </section>

          {errorMessage && (
            <p
              role="alert"
              data-testid="register-sensor-error"
              className="text-2xs text-accent-red"
            >
              {errorMessage}
            </p>
          )}

          <footer className="flex items-center justify-end gap-2 border-t border-fg-20 pt-3">
            <Button type="button" variant="ghost" onClick={onClose} disabled={register.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {register.isPending ? "Registering…" : "Register sensor"}
            </Button>
          </footer>
        </form>
      )}
    </Drawer>
  );
}

function CertReveal({
  response,
  onClose,
}: {
  response: SensorRegisterResponse;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4" data-testid="cert-reveal">
      <section className="flex flex-col gap-2 rounded-md border border-accent-amber/40 bg-accent-amber/10 p-3 text-xs text-accent-amber">
        <header className="text-2xs font-semibold uppercase tracking-wide">
          Copy these credentials now
        </header>
        <p className="text-fg-100">
          The private key is shown <strong>once</strong>. The backend stores only its fingerprint —
          we cannot re-issue this exact material, so once this drawer closes the secret is gone.
          Save the three blocks below to <code className="font-mono">/etc/cheeky-pony/</code> on the
          Pi.
        </p>
      </section>

      <PemBlock
        label="CA certificate"
        filename={`${response.sensor.id}-ca.pem`}
        contents={response.ca_certificate_pem}
        testId="cert-ca"
      />
      <PemBlock
        label="Client certificate"
        filename={`${response.sensor.id}-cert.pem`}
        contents={response.client_certificate_pem}
        testId="cert-client"
      />
      <PemBlock
        label="Client private key"
        filename={`${response.sensor.id}-key.pem`}
        contents={response.client_private_key_pem}
        secret
        testId="cert-key"
      />

      <footer className="flex items-center justify-end gap-2 border-t border-fg-20 pt-3">
        <Button type="button" variant="primary" onClick={onClose}>
          Done
        </Button>
      </footer>
    </div>
  );
}

interface PemBlockProps {
  label: string;
  filename: string;
  contents: string;
  /** Mask the body until the operator clicks reveal. */
  secret?: boolean;
  testId: string;
}

function PemBlock({
  label,
  filename,
  contents,
  secret = false,
  testId,
}: PemBlockProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(!secret);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(contents);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API may be unavailable in non-secure contexts; the
      // textarea below stays selectable as a manual-copy fallback.
    }
  };

  return (
    <section className="flex flex-col gap-1.5" data-testid={testId}>
      <header className="flex items-center justify-between gap-2">
        <span className="text-2xs uppercase tracking-wide text-fg-60">{label}</span>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-2xs text-fg-40">{filename}</span>
          {secret && !revealed && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setRevealed(true)}>
              Reveal
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void copy()}
            aria-label={`Copy ${label}`}
          >
            {copied ? (
              <Check className="size-3.5 text-accent-green" aria-hidden="true" />
            ) : (
              <Copy className="size-3.5" aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </header>
      <textarea
        readOnly
        rows={5}
        value={revealed ? contents : "•".repeat(64)}
        aria-label={label}
        spellCheck={false}
        className="w-full resize-y rounded-sm border border-fg-20 bg-bg-inset p-2 font-mono text-2xs text-fg-100"
      />
    </section>
  );
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
