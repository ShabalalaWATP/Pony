import { X } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { Separator } from "@/components/ui/Separator";
import { useUIStore } from "@/stores/useUIStore";

interface ShortcutGroup {
  label: string;
  shortcuts: { keys: readonly string[]; description: string }[];
}

const SHORTCUTS: ShortcutGroup[] = [
  {
    label: "Navigation",
    shortcuts: [
      { keys: ["⌘", "K"], description: "Open command palette" },
      { keys: ["g", "o"], description: "Go to Overview" },
      { keys: ["g", "s"], description: "Go to Sensors" },
      { keys: ["g", "n"], description: "Go to Networks" },
      { keys: ["g", "d"], description: "Go to Devices" },
      { keys: ["g", "e"], description: "Go to Events" },
      { keys: ["g", "a"], description: "Go to Alerts" },
      { keys: ["g", "l"], description: "Go to Lab (when visible)" },
    ],
  },
  {
    label: "Layout",
    shortcuts: [
      { keys: ["["], description: "Collapse sidebar" },
      { keys: ["]"], description: "Expand sidebar" },
      { keys: ["?"], description: "Show this cheat sheet" },
      { keys: ["esc"], description: "Close modal / drawer / palette" },
    ],
  },
  {
    label: "Coming in later stages",
    shortcuts: [
      { keys: ["/"], description: "Focus the current page's search (Stage 5)" },
      { keys: ["j"], description: "Move selection down in lists (Stage 5)" },
      { keys: ["k"], description: "Move selection up in lists (Stage 5)" },
      { keys: ["c"], description: "Copy selected row's primary identifier (Stage 5)" },
      { keys: ["Enter"], description: "Open selected row in drawer (Stage 5)" },
    ],
  },
];

export function CheatSheet(): JSX.Element | null {
  const open = useUIStore((s) => s.cheatSheetOpen);
  const close = useUIStore((s) => s.closeCheatSheet);

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

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-40 flex items-center justify-center bg-bg-0/60 backdrop-blur-md px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="w-full max-w-2xl rounded-lg border border-fg-20 bg-bg-2 shadow-2xl shadow-black/40">
        <div className="flex items-center justify-between border-b border-fg-20 px-5 py-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-fg-60">
            Keyboard shortcuts
          </h2>
          <Button variant="ghost" size="icon" onClick={close} aria-label="Close cheat sheet">
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="grid max-h-[70vh] grid-cols-1 gap-6 overflow-y-auto p-5 sm:grid-cols-2">
          {SHORTCUTS.map((group, i) => (
            <section
              key={group.label}
              className={i === SHORTCUTS.length - 1 ? "sm:col-span-2" : ""}
            >
              <div className="mb-3 text-2xs uppercase tracking-wide text-fg-60">{group.label}</div>
              <Separator className="mb-3" />
              <ul className="flex flex-col gap-2">
                {group.shortcuts.map((s) => (
                  <li
                    key={s.description}
                    className="flex items-center justify-between gap-3 text-sm text-fg-80"
                  >
                    <span>{s.description}</span>
                    <span className="flex items-center gap-1">
                      {s.keys.map((k, idx) => (
                        <Kbd key={`${s.description}-${idx}`}>{k}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
