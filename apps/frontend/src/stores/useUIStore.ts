import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UIState {
  sidebarCollapsed: boolean;
  commandPaletteOpen: boolean;
  cheatSheetOpen: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;
  openCheatSheet: () => void;
  closeCheatSheet: () => void;
}

/**
 * Global UI state. Persisted across reloads via localStorage so the
 * operator's sidebar preference and last-open panel survive a refresh.
 *
 * Only ephemeral, UI-shape state goes here — anything authoritative
 * lives in TanStack Query (server state) or a dedicated store.
 */
export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      commandPaletteOpen: false,
      cheatSheetOpen: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      openCommandPalette: () => set({ commandPaletteOpen: true }),
      closeCommandPalette: () => set({ commandPaletteOpen: false }),
      toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
      openCheatSheet: () => set({ cheatSheetOpen: true }),
      closeCheatSheet: () => set({ cheatSheetOpen: false }),
    }),
    {
      name: "cp-ui",
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed }),
    },
  ),
);
