import { CheckCircle2, ShieldX, XCircle } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/domain/EmptyState";
import {
  type LabStatusResponse,
  useAcknowledgeOperator,
  useLabStatus,
} from "@/services/api/labQueries";

/**
 * The canonical Authorized-Operator acknowledgement statement. The
 * exact same string is sent in the POST body and the operator must
 * type it back verbatim to enable the submit — backend hashes it
 * server-side so a tampered client can't desync the contract.
 *
 * Wording covers the non-negotiables in CLAUDE.md / the threat model
 * (written permission, lawful purpose, no third-party impact). Keep
 * one string — multi-line text is rendered with `whitespace-pre-wrap`.
 */
const STATEMENT = [
  "I am an authorised operator of this Cheeky Pony deployment.",
  "I will only use the active modules against networks I own or have explicit written permission to assess.",
  "I accept that every active action is recorded in an immutable audit log keyed to my user identity.",
].join("\n");

/**
 * `/settings/system` — the operator's one window into the gates that
 * decide whether active lab modules can fire. Same flags surface
 * (LAB_MODE, acknowledgement, admin+2FA) plus the typed acknowledgement
 * form when the gate is not yet on file.
 *
 * The form is admin + recent-2FA + CSRF gated server-side; the
 * frontend renders the 403 verbatim instead of pre-checking, so the
 * gate enforcement stays in one place (the backend) and the UI just
 * surfaces what the backend already told it.
 */
export function SystemView(): JSX.Element {
  const statusQuery = useLabStatus();
  const ack = useAcknowledgeOperator();
  const [typed, setTyped] = useState("");

  if (statusQuery.error?.status === 401 || statusQuery.error?.status === 403) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="System" />
        <EmptyState
          title="Sign in required"
          description="System settings need an authenticated session."
        />
      </div>
    );
  }

  const status = statusQuery.data;
  const ackOnFile = Boolean(status?.acknowledgement_on_file) || ack.isSuccess;
  const ready = typed.trim() === STATEMENT.trim();
  const canSubmit = ready && !ack.isPending && !ackOnFile;

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!canSubmit) return;
    ack.mutate({ statement: STATEMENT });
  };

  return (
    <div className="flex flex-col gap-6" data-testid="settings-system">
      <PageHeader title="System" />

      {status ? (
        <GateStatusCard status={status} ackOnFile={ackOnFile} />
      ) : (
        <Skeleton className="h-32 w-full" />
      )}

      <section className="flex flex-col gap-3 rounded-md border border-fg-20 bg-bg-2 p-5">
        <header className="flex items-center gap-2 text-2xs uppercase tracking-wide text-fg-60">
          <ShieldX className="size-3.5" aria-hidden="true" />
          Authorized-operator acknowledgement
        </header>

        {ackOnFile ? (
          <p
            className="flex items-center gap-2 rounded-sm border border-accent-green/40 bg-accent-green/10 px-3 py-2 text-xs text-accent-green"
            data-testid="ack-on-file"
          >
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
            On file — no further action needed.
          </p>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={handleSubmit} data-testid="ack-form">
            <pre
              data-testid="ack-statement"
              className="whitespace-pre-wrap rounded-sm border border-fg-20 bg-bg-inset p-3 text-xs text-fg-100"
            >
              {STATEMENT}
            </pre>
            <label className="flex flex-col gap-1.5">
              <span className="text-2xs uppercase tracking-wide text-fg-60">
                Type the statement above to confirm
              </span>
              <textarea
                rows={5}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="Re-type the statement exactly"
                aria-label="Type the statement to confirm"
                aria-invalid={typed !== "" && !ready}
                spellCheck={false}
                className="w-full rounded-sm border border-fg-20 bg-bg-1 p-2 text-sm text-fg-100 focus-visible:border-fg-40 focus-visible:outline-none"
              />
              <span
                className={
                  typed === ""
                    ? "text-2xs text-fg-60"
                    : ready
                      ? "text-2xs text-accent-green"
                      : "text-2xs text-accent-amber"
                }
              >
                {typed === ""
                  ? "Accept stays disabled until you type the statement verbatim."
                  : ready
                    ? "Statement matches — Accept is unlocked."
                    : "Doesn't match yet."}
              </span>
            </label>
            {ack.error && (
              <p role="alert" className="text-2xs text-accent-red">
                {ack.error.status === 403
                  ? "Admin role + recent TOTP is required to record this acknowledgement."
                  : ack.error.message}
              </p>
            )}
            <div className="flex justify-end">
              <Button type="submit" variant="primary" disabled={!canSubmit}>
                {ack.isPending ? "Recording…" : "Accept"}
              </Button>
            </div>
          </form>
        )}
        <p className="text-2xs text-fg-60">
          The statement is recorded in the audit log keyed to the current operator. The backend
          stores a hash of the text you type, so a tampered statement won&apos;t pass.
        </p>
      </section>
    </div>
  );
}

interface GateStatusCardProps {
  status: LabStatusResponse;
  ackOnFile: boolean;
}

function GateStatusCard({ status, ackOnFile }: GateStatusCardProps): JSX.Element {
  const gates: { label: string; ok: boolean; hint: string }[] = [
    {
      label: "Lab mode",
      ok: status.lab_mode,
      hint: "Set LAB_MODE=true on the backend.",
    },
    {
      label: "Authorized-operator acknowledgement",
      ok: ackOnFile,
      hint: "Type and accept the statement below.",
    },
    {
      label: "Admin + recent 2FA",
      ok: status.is_admin_2fa,
      hint: "Sign in as admin and re-verify TOTP.",
    },
  ];
  const allGreen = gates.every((g) => g.ok);
  return (
    <section
      data-testid="system-gate-card"
      className={
        allGreen
          ? "rounded-md border border-accent-green/40 bg-accent-green/10 p-4 text-sm text-accent-green"
          : "rounded-md border border-accent-amber/40 bg-accent-amber/10 p-4 text-sm text-accent-amber"
      }
    >
      <header className="flex items-center gap-2 text-2xs uppercase tracking-wide">
        {allGreen ? (
          <CheckCircle2 className="size-3.5" aria-hidden="true" />
        ) : (
          <ShieldX className="size-3.5" aria-hidden="true" />
        )}
        Lab gates
      </header>
      <ul className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
        {gates.map((g) => (
          <li
            key={g.label}
            data-testid="system-gate"
            data-ok={g.ok}
            className="flex items-start gap-2 text-fg-100"
          >
            {g.ok ? (
              <CheckCircle2
                className="mt-0.5 size-3 shrink-0 text-accent-green"
                aria-hidden="true"
              />
            ) : (
              <XCircle className="mt-0.5 size-3 shrink-0 text-accent-red" aria-hidden="true" />
            )}
            <span className="flex flex-col">
              <span>{g.label}</span>
              {!g.ok && <span className="text-2xs text-fg-60">{g.hint}</span>}
              {g.ok && (
                <span className="text-2xs text-fg-60">
                  <Badge tone="green" outline>
                    on
                  </Badge>
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
