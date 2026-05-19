import { Command } from "cmdk";
import { useNavigate } from "@tanstack/react-router";
import { Command as CommandIcon } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Kbd } from "@/components/ui/Kbd";
import { cn } from "@/lib/cn";
import { useLabModeStore } from "@/stores/useLabModeStore";
import { useUIStore } from "@/stores/useUIStore";
import { PALETTE_ITEMS, type PaletteContext } from "./commandPaletteItems";

/**
 * Global command palette (⌘K / Ctrl+K).
 *
 * Renders the configured `PALETTE_ITEMS` — to add a new entry, edit the
 * registry file; the component itself stays untouched (open/closed).
 *
 * Closes on Esc, on backdrop click, and after any successful command
 * dispatch. Recent items, sensor jumps, and mutating verbs (with the
 * inline confirm per design spec §7) arrive in later stages.
 */
export function CommandPalette(): JSX.Element {
  const open = useUIStore((s) => s.commandPaletteOpen);
  const close = useUIStore((s) => s.closeCommandPalette);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const groups = useMemo(() => Array.from(new Set(PALETTE_ITEMS.map((i) => i.group))), []);

  if (!open) return <></>;

  const ctx: PaletteContext = {
    navigate,
    ui: useUIStore.getState(),
    lab: useLabModeStore.getState(),
    close,
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-bg-0/60 px-4 pt-[12vh] backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <Command
        className={cn(
          "w-full max-w-xl overflow-hidden rounded-lg border border-fg-20 bg-bg-2",
          "shadow-2xl shadow-black/40",
        )}
        label="Command palette"
      >
        <div className="flex items-center gap-2 border-b border-fg-20 px-4 py-3">
          <CommandIcon className="size-4 text-fg-60" aria-hidden="true" />
          <Command.Input
            placeholder="Jump to a route, run a verb…"
            className="flex-1 bg-transparent text-sm text-fg-100 placeholder:text-fg-40 focus:outline-none"
          />
          <Kbd>esc</Kbd>
        </div>
        <Command.List className="max-h-96 overflow-y-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-xs text-fg-60">
            No matches.
          </Command.Empty>
          {groups.map((group) => (
            <Command.Group
              key={group}
              heading={group}
              className="px-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-fg-60"
            >
              {PALETTE_ITEMS.filter((i) => i.group === group).map((item) => (
                <Command.Item
                  key={item.id}
                  value={`${item.group} ${item.label}`}
                  onSelect={() => item.perform(ctx)}
                  className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm text-fg-80 aria-selected:bg-bg-3 aria-selected:text-fg-100"
                >
                  <item.Icon className="size-4 text-fg-60" aria-hidden="true" />
                  <span className="flex-1">{item.label}</span>
                  {item.hint && <Kbd>{item.hint}</Kbd>}
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}
