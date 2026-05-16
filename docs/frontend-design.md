# Cheeky Pony — Frontend Design Spec

> **Single source of truth for visual + interaction design.** Read this before opening a component file. If you're about to make a design call that isn't covered here, **add it here first**, then write the code.

## 1. Brand & positioning

**Product personality**: operator-grade WiFi reconnaissance and offensive tooling. The UI should feel like something you'd see on a screen in a security-team war-room — confident, kinetic, information-rich, **never gaudy**. Reference points: classic Bloomberg terminal density meets Linear-grade polish meets the cyberpunk colour discipline of late-2020s SOC tooling.

**Naming**: codename "Cheeky Pony" throughout. Internal abbreviation `CP` is fine. **Never** ship the string "WiFi Pineapple" or any Hak5 mark in user-visible UI, docs, or strings.

**Wordmark**: `CHEEKY//PONY` set in **Space Grotesk** 600 weight, +120 letter-spacing, uppercase. The `//` lives in the mode-accent (cyan by default, violet in lab mode); the words sit at `foreground/95`. On data-bearing screens the `//` is a live-pulse indicator — it pulses at 1.2Hz only when the active sensor has emitted an event in the last 5 seconds. Stale data flattens it to `foreground/30`.

**Glyph** (24px and 16px inline SVG, single-colour `currentColor`): an abstract "tracking diamond" — a rhombus with a triangular notch cut from the right corner indicating directionality, plus two concentric arc fragments representing RF sweep. Reads as both a compass and a radar at small sizes. Source: `apps/frontend/src/components/branding/Glyph.tsx`.

**Loading screen**: black background, glyph centred, wordmark below, a single 1px cyan line sweeping left→right at 600ms ease-in-out. No spinners. Reduced-motion: static glyph + a `…` that updates every 800ms.

## 2. Design tokens

All tokens live in `apps/frontend/src/styles/tokens.css` as CSS custom properties and are surfaced to Tailwind via `@theme` in `globals.css`. **No hardcoded hex anywhere outside `tokens.css` and `Glyph.tsx`.**

### Colour

```
/* Surfaces (HSL components, no hsl() wrapper, so alpha mixing is trivial) */
--bg-0:        220 18%  4%;   /* page background — near-black, slight cyan tint */
--bg-1:        220 16%  7%;   /* default surface */
--bg-2:        220 14%  10%;  /* elevated surface (cards) */
--bg-3:        220 12%  14%;  /* sticky chrome (topbar, drawer headers) */
--bg-inset:    220 22%  3%;   /* code blocks, console panes */

/* Foreground */
--fg-100:      220 14%  98%;  /* primary text */
--fg-80:       220 12%  82%;  /* secondary text */
--fg-60:       220 10%  62%;  /* tertiary text, table headers */
--fg-40:       220  8%  42%;  /* disabled, captions */
--fg-20:       220  6%  22%;  /* dividers */

/* Accents — used sparingly. Rule: ≤ 8% of a viewport should be saturated colour. */
--accent-cyan:    188 95% 56%;   /* primary accent, live state, links, focus */
--accent-violet:  264 90% 70%;   /* secondary accent, lab-mode chrome */
--accent-amber:   38 100% 60%;   /* warnings, throttled state */
--accent-red:     0  90% 62%;    /* criticals, refused/blocked */
--accent-green:   142 70% 50%;   /* healthy, authorized, acked */

/* Mode signal — switches to violet when LAB_MODE is engaged. */
--mode-accent: var(--accent-cyan);

/* Glow (only on focus, active sensor, fresh data — never decorative) */
--glow-cyan, --glow-violet, --glow-mode: 0 0 0 1px / 0 0 24px / 0.18

/* Grid texture overlay (page bg only) — 32px grid, 1px lines at 4% opacity */
--texture-grid
```

**Contrast budget**: fg-100 on bg-1 = 16.2:1 (AAA). fg-60 on bg-2 = 5.1:1 (AA). Never put primary text below `fg-80` on `bg-1+`.

**Lab-mode chrome shift**: when `LAB_MODE=true`, set `data-lab-mode="true"` on `<html>`. That flips `--mode-accent` to violet, which propagates through every component that uses the `text-mode` / `bg-mode` utilities. **Operators must never confuse passive and active mode.**

### Type

- `--font-sans` — Geist Variable
- `--font-mono` — Geist Mono Variable
- `--font-display` — Space Grotesk Variable

Scale (tight, 1.18 ratio): `text-2xs` 11/16 · `text-xs` 12/18 · `text-sm` 13/20 · `text-base` 14/22 · `text-md` 16/24 · `text-lg` 19/28 · `text-xl` 24/32 · `text-2xl` 30/38.

**Mono-by-default rule**: any value that is identity, count, timestamp, MAC, BSSID, IP, signal value, channel, frequency, hash, or coordinate — **mono**. Any prose — sans. Mixing the two is how data communicates "I'm a value, not a label."

### Motion

- Default transition: `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-expo), **140ms**.
- Drawer / sheet enter: 220ms with 8px translate.
- Route transitions: opacity-only, 120ms.
- Tooltip delay: 300ms open, 80ms close.
- Live-data pulse: 1.2Hz, opacity 0.4 → 1.0, **only** when fresh (<5s old). Never decorative.
- Reduced-motion: every transition collapses to 0ms; pulses become static. Honoured globally via `useReducedMotion()`.

## 3. Visual language

### Five canvas treatments (never improvise a sixth)

1. **Page** — `bg-0` + grid texture overlay at 4% opacity. Only on `<body>`.
2. **Default surface** — `bg-1`, flat.
3. **Card** — `bg-2 border-fg-20`.
4. **Inset** — `bg-inset border-fg-20`. Code, console, raw-event dumps.
5. **Sticky chrome** — `bg-3`, optionally `backdrop-blur-md` on overlays.

### Glow rules

Glow appears in **exactly three contexts**: (1) `:focus-visible` rings; (2) the currently-active sensor row / streaming module panel; (3) the 2-second "fresh data" cyan halo on rows just inserted. **Never** on cards by default, on hover, on text, or as decoration.

### Texture & detail

Page-bg 32px grid at 4% opacity. Single 1px scanline traverses the topbar every 8 seconds at 4% opacity (`cp-scanline` keyframe). **No** decorative noise, glitch effects, animated gradients, parallax, fake "boot sequences", or Matrix rain.

### Icons

[Lucide](https://lucide.dev) at 16px (inline) / 18px (buttons) / 20px (sidebar) / 24px (empty states). 1.5px stroke. Always `currentColor`.

### Charts

Categorical palette: `[cyan, violet, amber, green, fg-60, fg-40]`. Sequential: cyan→violet. Diverging severity: red→amber→green. Tooltips: `bg-3 border-fg-20`, mono. All charts pair colour with a shape or label — never colour alone.

## 4. Information architecture

```
/login                          email + password → TOTP
/                               Overview (operator home)
/sensors                        Sensor fleet
/sensors/$sensorId              Sensor detail
/networks                       Access Points
/networks/$bssid                AP detail (drawer)
/devices                        Clients
/devices/$mac                   Client detail (drawer)
/events                         Raw event log (virtualised)
/alerts                         Inbox
/alerts/rules                   Rule editor
/map                            MapLibre AP map
/engagements                    Scope + allow-lists
/lab                            Visible only when LAB_MODE=true AND authorized
/lab/{rogue-ap,deauth,evil-twin,captive-portal,mitm}
/audit                          Append-only log
/settings/{account,users,system,about}
/design-system                  Internal showcase (Stage 1 home)
```

Default route after login: `/`. Breadcrumbs in topbar, mono.

## 5. Layout system

```
Topbar 48px [glyph + wordmark] [breadcrumb] [⌘K] [live-status] [user]
Sidebar 208px (collapses to 56px via [/])
Main fluid, max-width 1440px, 32px gutter
Right drawer 480px (used for detail without losing list context)
```

Breakpoints: `sm` 640 (min supported), `md` 768, `lg` 1024 (sidebar inline 56px), `xl` 1280 (sidebar 208px), `2xl` 1536. Below 640px we show a "not supported on mobile" interstitial.

## 6. Components (Stage 1 inventory)

Built and shipped in this PR:

- `components/branding/{Glyph, Wordmark}`
- `components/ui/{Button, Input, Badge, Chip, Tooltip, Skeleton, Separator, Kbd}`
- `components/domain/{LiveDot, SignalBars, SignalSparkline, MacAddress, RelativeTime, EncryptionChip, AlertSeverityChip, StatTile, EmptyState, ChannelBadge}`

Stage 2+ adds: `AppShell`, `Sidebar`, `Topbar`, `CommandPalette`, `Breadcrumbs`, `PageHeader`, `RightDrawer`, `DataTable`, `EventConsole`, `LabModeBanner`, `LoginForm`, `TotpInput`, `AuthGuard`, the per-route feature components.

**File-size rule**: component file ≤ 400 lines; function ≤ 50 lines. Split before abstracting.

## 7. Interaction patterns

**Keyboard-first** — the product is operable without a mouse during an engagement:

| Key                | Action                                |
| ------------------ | ------------------------------------- |
| `⌘K` / `Ctrl+K`    | Command palette                       |
| `g o/s/n/d/e/a/l`  | Jump to route                         |
| `[` / `]`          | Collapse / expand sidebar             |
| `/`                | Focus the current page's search       |
| `j` / `k`          | Move selection                        |
| `Enter`            | Open selected row in drawer           |
| `Esc`              | Close drawer / modal / palette        |
| `?`                | Hotkey cheat-sheet overlay            |
| `c`                | Copy selected row's primary id        |
| `Shift+Click`      | Multi-select                          |
| `⌘.` / `Ctrl+.`    | Acknowledge top alert                 |

**Command palette** (cmdk) indexes routes, sensors, recent APs/devices, alert rules, and verbs. Mutating verbs require an inline confirm.

**Drill-down model**: row click → right drawer (URL updates so state is shareable). Cmd-click → full page.

**Copy & paste**: every monospace identifier has a click-to-copy affordance — hover reveals a 12px copy icon; click copies and flashes the value cyan for 220ms. `c` copies the current row.

## 8. Real-time UX

- One operator WebSocket carrying topic-scoped messages. TanStack Query invalidations + WS nudges keep state coherent.
- Fresh-data halo: 1px cyan left-border that fades out over 1.5s. Never more than 2s of visual disturbance.
- KPI numbers tween 200ms on change only. Suppressed if > 10 changes/sec (anti-strobing).
- Stale-data degradation: `RelativeTime` colour shifts amber → red, row fades to 60% opacity after the offline threshold.
- WS-drop banner: 2px amber bar under the topbar; goes green briefly on recovery.
- Backpressure: throttle to 50 events/sec on the wire with a "throttled" badge.

## 9. States

**Empty**: glyph at 40% + headline + body + (optional) CTA. Never raw "No data".
**Loading**: `Skeleton` components matching the eventual shape. **Never spinners** on data surfaces.
**Error**: inline / toast / page tiers. The page tier always shows a copyable request ID.
**Dangerous** (lab actions): `DangerConfirm` modal with type-to-confirm input that shows target, engagement, lab-mode state, and allow-list membership. If any gate is missing the route doesn't exist — never shown-but-disabled.

## 10. Accessibility

- Keyboard reachable; focus-visible cyan glow ring; skip-to-main link.
- Every icon `aria-label`; tables `aria-sort`; live regions for toasts and reconnect.
- WCAG AA min on body (4.5:1), AAA on KPI numbers and headings (7:1).
- Severity chips: text label + icon shape, not colour alone.
- All motion respects `prefers-reduced-motion`.
- Layout holds at 200% browser zoom on `xl`.
- CI gate: `axe-core` Playwright check on every primary route (added Stage 5).

## 11. The "techy" effects budget

**DO** (with discipline): page-bg grid texture, topbar scanline, wordmark `//` pulse, focus glow, fresh-data halo, mono identifiers, lab-mode chrome shift, xterm.js console on sensor detail.

**DO NOT**: Matrix rain, glitch text, fake boot sequences, CRT curvature, pulsing/glowing buttons at rest, animated gradients, decorative parallax, sounds, OCR-B / faux-LCD / pixel fonts, decorative neon edges. **Rule of thumb**: if a competent SOC operator wouldn't take it seriously, cut it.

## 12. Code organisation

```
apps/frontend/src/
├── main.tsx                  # entry
├── App.tsx                   # router root (Stage 1 renders /design-system directly)
├── routes/                   # per-route page components
├── components/{ui,domain,branding,layout,auth,…}/
├── hooks/
├── services/{api,ws,auth}/
├── stores/                   # Zustand UI state
├── styles/{tokens,globals}.css
├── lib/                      # pure utilities
├── assets/
└── test/                     # Vitest setup + colocated tests
```

No file over 400 lines, no function over 50.

## 13. Build order (visible-slice-first)

1. **Stage 1 — Foundation** (this PR): Vite + TS + Tailwind 4, tokens, fonts, primitives, branding, `/design-system` showcase, OpenAPI types generated and committed, CI frontend job.
2. **Stage 2 — Shell**: AppShell + Sidebar + Topbar + CommandPalette + TanStack Router + route stubs.
3. **Stage 3 — Auth**: `/login`, TOTP, AuthGuard, session refresh, lab-mode store.
4. **Stage 4 — Overview + live data**: operator WS client, `useLiveTopic`, KPI tiles, live event stream, signal histogram.
5. **Stage 5 — Sensors + Networks + Devices**: list/drawer pairs. Closes milestone-3-equivalent scope.

Tests, Lighthouse, axe-core all enforced from Stage 1.

## 14. Operator guide deliverable

Every stage updates `docs/operator-guide.md` with annotated screenshots. PDF export is generated from this markdown in CI on tagged releases.
