import { useEffect } from "react";
import { create } from "zustand";

interface LabModeState {
  /**
   * Whether the operator has *previewed* lab mode in this session.
   *
   * Stage 2: this is a UI-only toggle exposed on /design-system so the
   * chrome shift can be eyeballed. Stage 7 replaces this with a derived
   * value from the backend (LAB_MODE env + Authorized-Operator
   * acknowledgement + active engagement allow-list). Until then this
   * flag must never gate destructive UI surfaces — it is preview only.
   */
  preview: boolean;
  setPreview: (next: boolean) => void;
  togglePreview: () => void;
}

export const useLabModeStore = create<LabModeState>()((set) => ({
  preview: false,
  setPreview: (next) => set({ preview: next }),
  togglePreview: () => set((s) => ({ preview: !s.preview })),
}));

/**
 * Sync the store's `preview` flag to `data-lab-mode` on the document
 * root so global CSS (`--mode-accent`, grid tint, etc.) reacts.
 *
 * Mount once at the AppShell level.
 */
export function useLabModeChromeSync(): void {
  const preview = useLabModeStore((s) => s.preview);
  useEffect(() => {
    document.documentElement.dataset.labMode = String(preview);
    return () => {
      delete document.documentElement.dataset.labMode;
    };
  }, [preview]);
}
