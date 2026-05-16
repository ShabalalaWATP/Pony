import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUIStore } from "@/stores/useUIStore";
import { useLabModeStore } from "@/stores/useLabModeStore";

describe("useUIStore", () => {
  beforeEach(() => {
    useUIStore.setState({
      sidebarCollapsed: false,
      commandPaletteOpen: false,
      cheatSheetOpen: false,
    });
  });

  it("toggles the sidebar", () => {
    const { result } = renderHook(() => useUIStore());
    expect(result.current.sidebarCollapsed).toBe(false);
    act(() => result.current.toggleSidebar());
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
    act(() => result.current.toggleSidebar());
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });

  it("explicitly sets sidebar collapsed state", () => {
    const { result } = renderHook(() => useUIStore());
    act(() => result.current.setSidebarCollapsed(true));
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
  });

  it("opens, closes, and toggles the command palette", () => {
    const { result } = renderHook(() => useUIStore());
    expect(result.current.commandPaletteOpen).toBe(false);
    act(() => result.current.openCommandPalette());
    expect(useUIStore.getState().commandPaletteOpen).toBe(true);
    act(() => result.current.closeCommandPalette());
    expect(useUIStore.getState().commandPaletteOpen).toBe(false);
    act(() => result.current.toggleCommandPalette());
    expect(useUIStore.getState().commandPaletteOpen).toBe(true);
  });

  it("opens and closes the cheat sheet", () => {
    const { result } = renderHook(() => useUIStore());
    act(() => result.current.openCheatSheet());
    expect(useUIStore.getState().cheatSheetOpen).toBe(true);
    act(() => result.current.closeCheatSheet());
    expect(useUIStore.getState().cheatSheetOpen).toBe(false);
  });
});

describe("useLabModeStore", () => {
  beforeEach(() => {
    useLabModeStore.setState({ preview: false });
  });
  afterEach(() => {
    delete document.documentElement.dataset.labMode;
  });

  it("toggles preview", () => {
    const { result } = renderHook(() => useLabModeStore());
    expect(result.current.preview).toBe(false);
    act(() => result.current.togglePreview());
    expect(useLabModeStore.getState().preview).toBe(true);
  });

  it("sets preview explicitly", () => {
    const { result } = renderHook(() => useLabModeStore());
    act(() => result.current.setPreview(true));
    expect(useLabModeStore.getState().preview).toBe(true);
  });
});
