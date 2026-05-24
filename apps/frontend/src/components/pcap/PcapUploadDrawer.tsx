import { AlertCircle, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { useUploadPcap } from "@/services/api/pcapQueries";

interface PcapUploadDrawerProps {
  engagementId: string;
  open: boolean;
  onClose: () => void;
}

/** 100 MB, matching the backend `PCAP_MAX_UPLOAD_MB` cap (PR #62). */
const MAX_UPLOAD_BYTES = 100 * 1_048_576;

/**
 * Multipart-upload drawer for PCAPs. Mirrors the backend's
 * acceptance rules client-side (magic suffix + size cap) so the
 * operator gets immediate feedback rather than a 415 / 413 round
 * trip. The backend remains authoritative — these client checks are
 * UX only, not security.
 */
export function PcapUploadDrawer({
  engagementId,
  open,
  onClose,
}: PcapUploadDrawerProps): JSX.Element {
  const upload = useUploadPcap(engagementId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const reset = (): void => {
    setChosen(null);
    setValidationError(null);
    upload.reset();
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFile = (file: File | null): void => {
    upload.reset();
    setValidationError(null);
    if (!file) {
      setChosen(null);
      return;
    }
    if (!/\.(pcap|pcapng)$/i.test(file.name)) {
      setValidationError("File must end with .pcap or .pcapng");
      setChosen(null);
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setValidationError(`File is ${(file.size / 1_048_576).toFixed(1)} MB, max is 100 MB.`);
      setChosen(null);
      return;
    }
    setChosen(file);
  };

  const handleClose = (): void => {
    reset();
    onClose();
  };

  const submit = (): void => {
    if (!chosen) return;
    upload.mutate(chosen, {
      onSuccess: () => {
        reset();
        onClose();
      },
    });
  };

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title={
        <div className="flex items-center gap-2">
          <Upload className="size-4" aria-hidden="true" />
          Upload packet capture
        </div>
      }
    >
      <div className="flex flex-col gap-4" data-testid="pcap-upload-form">
        <p className="text-xs text-fg-60">
          .pcap or .pcapng up to 100 MB. The backend rejects files with the wrong magic bytes or
          oversized payloads before anything touches tshark.
        </p>

        <label className="flex flex-col gap-2 text-xs text-fg-80">
          File
          <input
            ref={inputRef}
            type="file"
            accept=".pcap,.pcapng"
            data-testid="pcap-file-input"
            onChange={(e) => handleFile(e.currentTarget.files?.[0] ?? null)}
            className="rounded-sm border border-fg-20 bg-bg-1 p-2 text-fg-100 file:mr-3 file:rounded-sm file:border file:border-fg-20 file:bg-bg-3 file:px-2 file:py-1 file:text-fg-100"
          />
        </label>

        {chosen && (
          <div
            className="rounded-sm border border-fg-20 bg-bg-1 px-3 py-2 text-xs text-fg-80"
            data-testid="pcap-chosen-summary"
          >
            <div className="font-mono">{chosen.name}</div>
            <div className="text-fg-60">{(chosen.size / 1_048_576).toFixed(1)} MB</div>
          </div>
        )}

        {validationError && (
          <div
            role="alert"
            data-testid="pcap-validation-error"
            className="flex items-start gap-2 rounded-sm border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-xs text-accent-red"
          >
            <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
            {validationError}
          </div>
        )}

        {upload.error && (
          <div
            role="alert"
            data-testid="pcap-upload-error"
            className="flex items-start gap-2 rounded-sm border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-xs text-accent-red"
          >
            <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
            {upload.error.message}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={handleClose} disabled={upload.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={submit}
            disabled={!chosen || upload.isPending}
            data-testid="pcap-upload-submit"
          >
            {upload.isPending ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
