import { Outlet, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { CheatSheet } from "./CheatSheet";
import { CommandPalette } from "./CommandPalette";
import { LabModeBanner } from "./LabModeBanner";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useHotkey, useHotkeySequence } from "@/hooks/useHotkey";
import { useLabModeChromeSync, useLabModeStore } from "@/stores/useLabModeStore";
import { useUIStore } from "@/stores/useUIStore";

/**
 * Top-level layout for authenticated routes (Stage 2: layout for every
 * route except `/login`; Stage 3 adds the AuthGuard).
 *
 * Mounts global hotkeys here so a hotkey-press anywhere reaches the
 * router and the UI stores. Each hotkey hook unsubscribes on unmount.
 */
export function AppShell(): JSX.Element {
  useLabModeChromeSync();
  const navigate = useNavigate();
  const labPreview = useLabModeStore((s) => s.preview);

  const toggleCommandPalette = useUIStore((s) => s.toggleCommandPalette);
  const setSidebarCollapsed = useUIStore((s) => s.setSidebarCollapsed);
  const openCheatSheet = useUIStore((s) => s.openCheatSheet);
  const closePalette = useUIStore((s) => s.closeCommandPalette);
  const closeCheatSheet = useUIStore((s) => s.closeCheatSheet);

  // ⌘K / Ctrl+K — toggle command palette.
  useHotkey("mod+k", (event) => {
    event.preventDefault();
    toggleCommandPalette();
  });

  // Esc closes overlays. cmdk and the cheat-sheet both also bind esc
  // internally; this is a belt-and-braces fallback.
  useHotkey("escape", () => {
    closePalette();
    closeCheatSheet();
  });

  // Sidebar collapse/expand.
  useHotkey("[", () => setSidebarCollapsed(true));
  useHotkey("]", () => setSidebarCollapsed(false));

  // Cheat sheet — shift required so `?` doesn't fire on key release etc.
  useHotkey("shift+?", openCheatSheet);

  // Route hotkeys (g <key> sequences).
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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg-0">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Topbar />
        <LabModeBanner />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-screen-2xl px-8 py-6">
            <Outlet />
          </div>
        </main>
      </div>
      <CommandPalette />
      <CheatSheet />
    </div>
  );
}
