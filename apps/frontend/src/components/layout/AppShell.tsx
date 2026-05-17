import { Outlet } from "@tanstack/react-router";
import { CheatSheet } from "./CheatSheet";
import { CommandPalette } from "./CommandPalette";
import { LabModeBanner } from "./LabModeBanner";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useAppShellHotkeys } from "@/hooks/useAppShellHotkeys";
import { useOperatorCacheInvalidations } from "@/services/ws/invalidations";
import { useLabModeChromeSync } from "@/stores/useLabModeStore";

/**
 * Top-level layout for every authenticated route.
 *
 * Composes the operator chrome (sidebar, topbar, lab-mode banner) and
 * the global overlays (command palette, cheat sheet) around the active
 * route's `<Outlet />`. Two side-effects fire once at mount:
 *
 * 1. `useLabModeChromeSync` — flips `[data-lab-mode]` on the document
 *    root whenever the preview store changes, so global tokens shift.
 * 2. `useAppShellHotkeys` — registers every global keyboard binding
 *    (⌘K, `[`/`]`, `?`, g-prefix nav, etc.). See the hook's docblock
 *    for the full table.
 * 3. `useOperatorCacheInvalidations` — listens for `aps.upsert`,
 *    `devices.upsert`, and `sensors.update` topics on the operator
 *    WebSocket and invalidates the matching TanStack Query caches so
 *    list views refresh without a manual reload.
 */
export function AppShell(): JSX.Element {
  useLabModeChromeSync();
  useAppShellHotkeys();
  useOperatorCacheInvalidations();

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
