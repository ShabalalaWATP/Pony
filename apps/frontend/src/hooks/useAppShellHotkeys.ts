import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useHotkey, useHotkeySequence } from "@/hooks/useHotkey";
import { useLabModeStore } from "@/stores/useLabModeStore";
import { useUIStore } from "@/stores/useUIStore";

/**
 * Register every global hotkey the operator dashboard responds to.
 *
 * - `⌘K` / `Ctrl+K` — toggle the command palette
 * - `Escape` — close any open overlay (palette, cheat sheet)
 * - `[` / `]` — collapse / expand the sidebar
 * - `Shift+?` — open the keyboard-shortcut cheat sheet
 * - `g o/s/n/d/e/a/l` — jump to Overview / Sensors / Networks / Devices /
 *   Events / Alerts / Lab. The Lab jump is gated on the preview toggle
 *   so non-lab operators don't accidentally land on a route they can't
 *   use.
 *
 * Kept in its own hook so `AppShell` reads cleanly — anyone changing
 * the bindings touches this file, not the layout shell.
 */
export function useAppShellHotkeys(): void {
  const navigate = useNavigate();
  const labPreview = useLabModeStore((s) => s.preview);
  const toggleCommandPalette = useUIStore((s) => s.toggleCommandPalette);
  const setSidebarCollapsed = useUIStore((s) => s.setSidebarCollapsed);
  const openCheatSheet = useUIStore((s) => s.openCheatSheet);
  const closePalette = useUIStore((s) => s.closeCommandPalette);
  const closeCheatSheet = useUIStore((s) => s.closeCheatSheet);

  useHotkey("mod+k", (event) => {
    event.preventDefault();
    toggleCommandPalette();
  });

  useHotkey("escape", () => {
    closePalette();
    closeCheatSheet();
  });

  useHotkey("[", () => setSidebarCollapsed(true));
  useHotkey("]", () => setSidebarCollapsed(false));
  useHotkey("shift+?", openCheatSheet);

  const goTo = useCallback(
    (to: string) => () => {
      void navigate({ to });
    },
    [navigate],
  );
  useHotkeySequence("g o", goTo("/"));
  useHotkeySequence("g s", goTo("/sensors"));
  useHotkeySequence("g n", goTo("/networks"));
  useHotkeySequence("g d", goTo("/devices"));
  useHotkeySequence("g e", goTo("/events"));
  useHotkeySequence("g a", goTo("/alerts"));
  useHotkeySequence("g l", () => {
    if (labPreview) {
      void navigate({ to: "/lab" });
    }
  });
}
