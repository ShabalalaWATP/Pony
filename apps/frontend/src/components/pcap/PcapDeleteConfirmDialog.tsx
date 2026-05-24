import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { type Pcap, useDeletePcap } from "@/services/api/pcapQueries";

interface PcapDeleteConfirmDialogProps {
  engagementId: string;
  pcap: Pcap | null;
  onClose: () => void;
}

/**
 * Typed-confirm dialog for PCAP deletion. The operator must type
 * `DELETE` to enable the destructive action — matches the backend's
 * `PcapDeleteRequest.confirm` contract (PR #62) and the
 * sensor-revoke pattern. Admin+TOTP+CSRF gating happens server-side;
 * the typed confirm is the client-side "are you sure" defense.
 */
export function PcapDeleteConfirmDialog({
  engagementId,
  pcap,
  onClose,
}: PcapDeleteConfirmDialogProps): JSX.Element {
  const del = useDeletePcap(engagementId);
  const [typed, setTyped] = useState("");

  const handleClose = (): void => {
    setTyped("");
    del.reset();
    onClose();
  };

  if (!pcap) return <></>;

  const matches = typed === "DELETE";
  const submit = (): void => {
    if (!matches) return;
    del.mutate(
      { pcapId: pcap.id, confirm: typed },
      {
        onSuccess: () => {
          handleClose();
        },
      },
    );
  };

  return (
    <Drawer
      open={Boolean(pcap)}
      onClose={handleClose}
      title={
        <div className="flex items-center gap-2 text-accent-red">
          <AlertTriangle className="size-4" aria-hidden="true" />
          Delete PCAP
        </div>
      }
    >
      <div className="flex flex-col gap-4" data-testid="pcap-delete-dialog">
        <p className="text-sm text-fg-100">
          Deleting <span className="font-mono text-fg-100">{pcap.filename_sanitized}</span> removes
          the capture bytes and every finding generated from them. This is irreversible and audited.
        </p>
        <label className="flex flex-col gap-2 text-xs text-fg-80">
          Type <code className="rounded-xs bg-bg-3 px-1 text-accent-red">DELETE</code> to confirm
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            data-testid="pcap-delete-confirm-input"
            className="rounded-sm border border-fg-20 bg-bg-1 p-2 font-mono text-fg-100"
            autoComplete="off"
          />
        </label>
        {del.error && (
          <div role="alert" className="text-xs text-accent-red">
            {del.error.message}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={handleClose} disabled={del.isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={submit}
            disabled={!matches || del.isPending}
            data-testid="pcap-delete-confirm-button"
          >
            {del.isPending ? "Deleting…" : "Delete PCAP"}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
