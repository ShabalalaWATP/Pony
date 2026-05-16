# Cheeky Pony — Frontend Design Spec

> **Single source of truth for visual + interaction design.** Read this before opening a component file. If you're about to make a design call that isn't covered here, **add it here first**, then write the code.

## 1. Brand & positioning

**Product personality**: operator-grade WiFi reconnaissance and offensive tooling. The UI should feel like something you'd see on a screen in a security-team war-room — confident, kinetic, information-rich, **never gaudy**. The reference points: classic Bloomberg terminal density meets Linear-grade polish meets the cyberpunk colour discipline of late-2020s SOC tooling (think Sysdig dark, Vercel observability, with more neon restraint than Tron).

**Naming**: codename "Cheeky Pony" throughout. Internal abbreviation `CP` is fine. **Never** ship the string "WiFi Pineapple" or any Hak5 mark in user-visible UI, docs, or strings.

**Wordmark**: `CHEEKY//PONY` set in **Space Grotesk** (or Geist Sans) **600 weight, +120 letter-spacing, uppercase**. The `//` is set in the cyan accent, the words in `foreground/95`. On data-bearing screens (overview, sensors, devices), the `//` is the live-pulse indicator — it pulses at 1.2Hz only when the active sensor has emitted an event in the last 5 seconds. When data is stale, the `//` flattens to `foreground/30` with no pulse. The wordmark itself doubles as a system-status signal.

**Glyph** (24px and 16px inline SVG, single-colour `currentColor`): an abstract "tracking diamond" — a rhombus with a small triangular notch cut from the right corner indicating directionality, plus three concentric arc fragments at 30°, 60°, 90° from the notch representing RF sweep. Reads as both a compass and a radar at small sizes. Lives at `src/assets/glyph.svg` and `src/components/branding/Glyph.tsx`.

**Loading screen**: black background, glyph centred, wordmark below, a single 1px cyan line sweeping left→right beneath the wordmark at 600ms ease-in-out. No spinners. Reduced-motion variant: static glyph + a `…` that updates every 800ms.

---

## 2. Design tokens

All tokens live in `src/styles/tokens.css` as CSS custom properties and are surfaced to Tailwind via `tailwind.config.ts`. **No hardcoded hex anywhere outside `tokens.css` and `Glyph.tsx`.**

### Colour

```
/* Surfaces (HSL for easy alpha tweaks) */
--bg-0:        220 18%  4%;   /* page background — near-black, slight cyan tint */
--bg-1:        220 16%  7%;   /* default surface */
--bg-2:        220 14%  10%;  /* elevated surface (cards, sidebars) */
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

/* Glow (only on focus, active sensor, fresh data — never decorative) */
--glow-cyan:   0 0 0 1px hsl(188 95% 56% / 0.4), 0 0 24px hsl(188 95% 56% / 0.18);
--glow-violet: 0 0 0 1px hsl(264 90% 70% / 0.4), 0 0 24px hsl(264 90% 70% / 0.18);

/* Grid texture overlay (page bg only) — 32px grid, 1px lines at 4% opacity */
--texture-grid: linear-gradient(hsl(220 14% 98% / 0.04) 1px, transparent 1px) 0 0 / 32px 32px,
                linear-gradient(90deg, hsl(220 14% 98% / 0.04) 1px, transparent 1px) 0 0 / 32px 32px;
```

**Contrast budget**: foreground/100 on bg/1 = 16.2:1 (AAA). foreground/60 on bg/2 = 5.1:1 (AA). Never put primary text below `fg-80` on `bg-1+`.

**Lab-mode chrome shift**: when `LAB_MODE=true` AND the user has authorized an active engagement, the topbar gains a 2px violet underline, the wordmark `//` shifts from cyan to violet, and the page-bg grid texture switches from cyan-tinted to violet-tinted. **This is not optional.** Operators must never confuse passive and active mode.

### Type

```
--font-sans:   'Geist', 'Inter', system-ui, sans-serif;     /* UI text */
--font-mono:   'Geist Mono', 'JetBrains Mono', monospace;   /* all data, IDs, timestamps */
--font-display: 'Space Grotesk', 'Geist', sans-serif;       /* wordmark, page titles */

/* Scale — tight, 1.18 ratio, monospace 1.0 */
text-2xs: 11px / 16px / 0.02em   (table headers, captions)
text-xs:  12px / 18px / 0em      (secondary)
text-sm:  13px / 20px / 0em      (default body)
text-base:14px / 22px / 0em      (primary)
text-md:  16px / 24px / -0.005em (subheadings)
text-lg:  19px / 28px / -0.01em  (section headings)
text-xl:  24px / 32px / -0.015em (page titles)
text-2xl: 30px / 38px / -0.02em  (overview KPIs)
```

**Mono-by-default rule**: any value that is identity, count, timestamp, MAC, BSSID, IP, signal value, channel, frequency, hash, or coordinate — **mono**. Any prose — sans. Mixing the two communicates: "this is data, that is description."

### Spacing & radius

```
space scale (Tailwind): 0.5 / 1 / 1.5 / 2 / 3 / 4 / 6 / 8 / 12 / 16  (4px base)
radius:  0 (none) / 2px (xs, chips) / 4px (sm, inputs) / 6px (md, cards) / 8px (lg, drawers) / full (pills)
```

Cards: `bg-bg-2 border border-fg-20 rounded-md`. Elevated panels: `bg-bg-2 border border-fg-20 rounded-lg shadow-[inset_0_1px_0_hsl(220_14%_98%/0.03)]` (the inset highlight is the only "glass" we do).

### Motion

- All transitions: `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-expo), **140ms** default.
- Drawer / sheet enter: **220ms** with 8px translate.
- Route transitions: opacity-only, **120ms**.
- Tooltip delay: **300ms** open, **80ms** close.
- Live-data pulse: 1.2Hz, opacity 0.4 → 1.0, **only** when fresh (<5s old). Never decorative.
- Reduced-motion: every transition collapses to `0ms`, pulse becomes a static dot. Honour `prefers-reduced-motion: reduce` globally via a `useReducedMotion()` hook wrapping Framer Motion.

### Sound — none

No audio anywhere in v1. Alerts can opt into Notification API browser notifications (which carry the system sound). The app itself stays silent.

---

## 3. Visual language

### The five canvas treatments

The UI uses five fixed background treatments, never invented ad-hoc:

1. **Page** — `bg-0` + grid texture overlay at 4% opacity. Used only on the outermost `<body>`.
2. **Default surface** — `bg-1`, flat. The default content background.
3. **Card** — `bg-2 border fg-20`. The reusable container.
4. **Inset** — `bg-inset border fg-20`. Code, console, raw-event dumps, monospace tables.
5. **Sticky chrome** — `bg-3` with `backdrop-blur-md` only on overlays (drawers, popovers, toasts). **Never** on the topbar/sidebar themselves — they're solid for performance.

### Glow / neon rules

Glow appears in **exactly three contexts**:

1. Focus rings on interactive elements (`:focus-visible` only — never on click).
2. The currently-active sensor's row, the currently-streaming module's panel.
3. A "fresh data" cyan halo on rows added in the last 2 seconds, fading to none over 1.5s.

Never on cards by default. Never on hover. Never on text. Never as decoration.

### Texture & detail

- Grid texture on page bg only (rule above).
- A subtle 1px scan line that traverses the top of the topbar every 8 seconds at 4% opacity. Decorative but disciplined — single line, off-screen most of the time, can't be missed but doesn't annoy. Disabled under reduced-motion.
- **No** decorative noise, no glitch effects, no animated gradients, no parallax, no terminal "boot sequence", no fake Matrix rain. We stay tasteful.

### Iconography

[Lucide](https://lucide.dev) at 16px (inline) / 18px (buttons) / 20px (sidebar) / 24px (empty states). 1.5px stroke. Always `currentColor`. Special domain icons (signal-strength bars, channel diagrams, encryption padlock-types) ship as custom SVGs under `src/components/icons/`.

### Charts

- Default palette: **categorical** uses `[cyan, violet, amber, green, fg-60, fg-40]` in that order. **Sequential** uses cyan-to-violet hue ramp. **Diverging** uses red-to-amber-to-green for severity, cyan-to-violet for neutral comparisons.
- Axes: `fg-40` lines, `fg-60` labels, `font-mono text-2xs`.
- Tooltips: `bg-3 border fg-20`, `font-mono text-xs`, animated 120ms.
- All charts respect colour-blind safety: never red/green alone as the only signal — always pair with a shape or label.
- Signal-strength sparklines: 24px tall, 80px wide, last 60 samples, area fill at 12% accent, line at 80% accent.

---

## 4. Information architecture

```
/login                                  email + password → TOTP step
/                                       Overview (the operator's home)
/sensors                                Sensor fleet list
/sensors/$sensorId                      Sensor detail (live event stream, channel control)
/networks                               Access Points table
/networks/$bssid                        AP detail drawer (probes, clients, signal history)
/devices                                Clients table
/devices/$mac                           Client detail drawer (probe history, AP associations)
/events                                 Virtualised raw event log with filter chips
/alerts                                 Alerts inbox
/alerts/rules                           Alert rule editor
/map                                    MapLibre AP map (geo)
/engagements                            List + create
/engagements/$id                        Scope rules, allow-lists, audit log
/lab                                    Visible only when LAB_MODE=true AND authorized
/lab/rogue-ap   /lab/deauth   /lab/evil-twin   /lab/captive-portal   /lab/mitm
/audit                                  Read-only audit log
/settings/account                       Profile + 2FA
/settings/users                         User management (admin only)
/settings/system                        System acknowledgements, retention, theme
/settings/about                         Build, version, SBOM, licenses
/design-system                          Internal: shows every component (dev-only route)
```

**Default route after login**: `/`.
**Surface hierarchy**: Overview > current Engagement > the route the operator last visited.
**Breadcrumbs**: in the topbar, only for nested routes (`Networks / a4:c3:f0:…:0a`). Click any segment to nav up. Mono.

---

## 5. Layout system

### Shell anatomy

```
┌────────────────────────────────────────────────────────────────────────┐
│ Topbar (48px)  [glyph + wordmark]  [breadcrumb]   [⌘K] [live] [user]  │  bg-3
├──────────┬─────────────────────────────────────────────────────────────┤
│          │                                                             │
│ Sidebar  │ Main                                                        │
│ (208px)  │ (fluid, max 1440px content width, 32px gutter)              │
│          │                                                             │
│ bg-2     │ bg-1                                                        │
│          │                                                             │
│  ┌Group:Recon                                                          │
│   • Overview   ⌘1                                                      │
│   • Sensors    ⌘2                                                      │
│   • Networks   ⌘3                                                      │
│   • Devices    ⌘4                                                      │
│   • Events     ⌘5                                                      │
│   • Map        ⌘6                                                      │
│   • Alerts     ⌘7                                                      │
│  ┌Group:Operate                                                        │
│   • Engagements   ⌘8                                                   │
│   • Lab (when on) ⌘9     ← appears with violet underline               │
│  ┌Group:System                                                         │
│   • Audit                                                              │
│   • Settings                                                           │
│                                                                        │
│  ┌Footer: sensor health pill, build hash, log out                      │
└──────────┴─────────────────────────────────────────────────────────────┘
```

**Sidebar**: 208px fixed, collapsible to 56px (icons only) via `[` and `]` hotkeys. State persisted to localStorage. Group labels in `text-2xs uppercase fg-60`. Active item: 2px cyan left bar + `bg-1` background, never a glow.

**Topbar (48px)**: glyph + wordmark left (clicking goes to `/`), breadcrumbs centre-left, command palette pill `⌘K` centre-right, live-status indicator (small dot + text "5 sensors, 1.2k events/min"), user menu right.

**Main**: `max-width: 1440px`, 32px gutter, 24px top padding. Centered.

**Right drawer**: 480px slide-in, used for detail views without losing the list context. Triggered by clicking a row in `/networks`, `/devices`, `/events`. Closes on ESC. URL reflects open state (e.g. `/networks?drawer=a4:c3:f0:…`).

### Breakpoints

```
sm:  640px   — minimum supported; sidebar collapses to overlay
md:  768px   — tablets; sidebar still overlay
lg:  1024px  — laptops; sidebar inline, 56px icons-only by default
xl:  1280px  — default work surface; sidebar 208px
2xl: 1536px  — generous; content centered with extra gutter
```

Below 640px we show a "Mobile not supported in v1 — install the app on a laptop" interstitial. We're not chasing phones in v1.

---

## 6. Per-route specifications (milestone 3 scope)

### /login

- Centred 360px card on a black page with grid texture, glyph + wordmark above.
- Email → password → "Continue" — submits credentials, gets challenge → TOTP 6-digit input with auto-advance per cell.
- Failed attempts: shake animation 280ms, mono error text below in red. Rate-limit message after 5 tries.
- Bottom: `v0.x.x · build a1b2c3d` in `fg-40 mono text-2xs`.

### / (Overview)

Single-screen, no scroll on a 1440×900 viewport. Six tiles in a 12-col grid:

```
┌──────────────── 12-col, 24px gap ─────────────────┐
│ [Sensors 4w]  [Devices 4w]   [APs 4w]            │   row 1 — KPI tiles (h=104px)
│ ┌──────────────────────┐ ┌──────────────────┐   │
│ │ Live event stream    │ │ Top APs by RSSI  │   │   row 2 — main (h=320px)
│ │ (8w, virtualised)    │ │ (4w, list)       │   │
│ └──────────────────────┘ └──────────────────┘   │
│ ┌──────────────────────┐ ┌──────────────────┐   │
│ │ Signal histogram     │ │ Recent alerts    │   │   row 3 — analytics (h=240px)
│ │ (8w, Recharts)       │ │ (4w, list)       │   │
│ └──────────────────────┘ └──────────────────┘   │
└────────────────────────────────────────────────────┘
```

KPI tile anatomy: huge mono number, label in `text-2xs fg-60 uppercase`, delta sparkline at bottom-right, click-through to the underlying view. Numbers tick with a 200ms tween — **only on change**, never decoratively.

Live event stream: virtualised list, newest at top, fresh-data halo on insert, hover reveals "open in /events" button.

### /sensors

List view with a sticky header (search, filter chips for online/offline/capability). Rows show: sensor name (mono), tailnet IP (mono), last-seen relative time, capability badges (passive/active/gps), event-rate sparkline (60s window), status pill (green/amber/red).

Click → drawer with:
- Header: sensor name + status pill + actions (`Restart`, `Update`, `Revoke`).
- Tabs: **Live stream** (xterm.js console of raw events), **Capabilities** (checklist), **Channel control** (channel hop schedule + manual override), **History** (uptime sparkline, last 24h event count).

### /networks

Virtualised table (TanStack Table + TanStack Virtual), 50k+ rows performant. Columns: SSID (sans, hidden→italic `<hidden>` placeholder), BSSID (mono), Vendor (sans), Channel (mono), Band (chip), Encryption (chip with padlock icon), RSSI (signal bars + mono dBm), Clients (mono int), Last seen (relative). Sort, filter chips at top, saved-views dropdown.

Row click → right drawer with AP detail (signal-strength chart over time, associated clients sublist, probe responses, raw frame samples, "Export PCAP" button).

### /devices

Same skeleton as /networks. Columns: MAC (mono), Vendor (sans), Probes count (mono), Associated AP (mono SSID), Strongest RSSI (signal bars), First/Last seen.

Drawer: client detail — probe history with timestamps (mono), AP associations on a small timeline, signal-strength sparkline, "Watch this device" toggle that creates an alert rule.

---

## 7. Component inventory

Built in `src/components/`. **Every component is < 200 lines.** Subdivide presentation vs container.

### Primitives (`components/ui/` — shadcn-derived)

`Button` · `Input` · `Label` · `Select` · `Checkbox` · `Switch` · `Slider` · `RadioGroup` · `Tabs` · `Tooltip` · `Popover` · `Dialog` · `Drawer` · `Sheet` · `Toast` · `Skeleton` · `Separator` · `ScrollArea` · `Avatar` · `Badge` · `Command` (cmdk) · `Accordion` · `Collapsible` · `Progress`

### Domain primitives (`components/domain/`)

| Component             | Purpose                                                                      |
| --------------------- | ---------------------------------------------------------------------------- |
| `StatTile`            | KPI: big mono number + label + delta sparkline + click-through.              |
| `LiveDot`             | Animated/static dot + "live"/"stale"/"offline" label. Reflects last-seen ts. |
| `SignalBars`          | 0–4 bars + dBm label. Threshold colouring (green/amber/red).                 |
| `SignalSparkline`     | 80×24 mini chart of last N RSSI samples.                                     |
| `EncryptionChip`      | WPA3/WPA2/WPA/WEP/Open chip with the appropriate padlock icon.               |
| `ChannelBadge`        | Channel + band (2.4 / 5 / 6 GHz) compact display.                            |
| `MacAddress`          | Renders MAC with vendor tooltip on hover; click-to-copy.                     |
| `Bssid`               | Same as MAC but emphasises the AP context.                                   |
| `RelativeTime`        | "12s ago" auto-updating, mono, falls back to absolute on hover.              |
| `SensorPill`          | Compact sensor identity + status combo.                                      |
| `AlertSeverityChip`   | Critical/High/Med/Low/Info.                                                  |
| `DangerConfirm`       | Modal with type-to-confirm input (lab actions only).                         |
| `EmptyState`          | Glyph + headline + body + optional CTA — for "no data yet" surfaces.         |
| `ErrorState`          | Same shape but for failures. Always recoverable, always shows the request ID.|
| `DataTable`           | Generic virtualised TanStack Table wrapper with our column primitives.       |
| `EventConsole`        | xterm.js wrapper that subscribes to a WS topic and renders raw JSONL.        |

### Layout components (`components/layout/`)

`AppShell` · `Sidebar` · `Topbar` · `CommandPalette` · `Breadcrumbs` · `PageHeader` · `SectionHeader` · `RightDrawer` · `LabModeBanner`

### Feature components (`components/{feature}/`)

Per route, a small set: `OverviewKPIs`, `OverviewEventStream`, `SensorList`, `SensorDetail`, `NetworkList`, `NetworkDetail`, etc.

### Auth (`components/auth/`)

`LoginForm` · `TotpInput` (6-cell auto-advancing input) · `AuthGuard` (route wrapper)

---

## 8. Interaction patterns

### Keyboard-first

The product is designed to be operable without a mouse during an engagement.

| Key            | Action                                              |
| -------------- | --------------------------------------------------- |
| `⌘K` / `Ctrl+K`| Open command palette                                |
| `g o`          | Go to Overview                                      |
| `g s`          | Go to Sensors                                       |
| `g n`          | Go to Networks                                      |
| `g d`          | Go to Devices                                       |
| `g e`          | Go to Events                                        |
| `g a`          | Go to Alerts                                        |
| `g l`          | Go to Lab (if visible)                              |
| `[` / `]`      | Collapse / expand sidebar                           |
| `/`            | Focus the current page's search                     |
| `j` / `k`      | Move selection down / up in any list                |
| `Enter`        | Open selected row in drawer                         |
| `Esc`          | Close drawer / modal / command palette              |
| `?`            | Hotkey cheat-sheet overlay                          |
| `c`            | Copy selected row's primary identifier (MAC/BSSID)  |
| `Shift+Click`  | Multi-select in lists                               |
| `⌘.` / `Ctrl+.`| Acknowledge top alert                               |

`?` opens a full cheat-sheet overlay (Linear-style). Hotkeys are also documented in `/settings/about` and in the operator guide.

### Command palette (cmdk)

`⌘K` opens a global palette indexed across: routes, sensors (by name + ID), recent APs/devices (by SSID/BSSID/MAC), alert rules, settings actions, and verbs (`Restart sensor wlan-pi-01`, `Acknowledge all alerts`, `Toggle sidebar`).

Verbs that have side effects (anything that mutates server state) require an inline confirm step in the palette before firing — no instant-execute on Enter for destructive actions.

### Drill-down model

A row in any table opens a **right drawer**, not a new page. The list stays visible behind. URL updates so the drawer state is shareable. Cmd-click opens the detail in a full page instead (`/networks/$bssid`).

### Selection & bulk actions

Lists support shift-click and `j/k + Space` to multi-select. A floating bottom action bar appears with verbs (`Add to allow-list`, `Tag`, `Export`, `Watch`). The bar shows the selection count in mono.

### Copy & paste

Every monospace identifier (MAC, BSSID, IP, sensor ID, event ID) has a click-to-copy affordance — hovering shows a 12px copy icon to the right; clicking copies and flashes the value cyan for 220ms. The `c` hotkey copies the current row's primary identifier.

### Filters & saved views

Every list view has a persistent filter chip bar. Filter chips show field + operator + value (`encryption = WPA3`, `last_seen < 5m`). Multiple chips AND together. Filter sets can be saved per-route as named views.

---

## 9. Real-time & live-data UX

The product is fundamentally real-time, so the live-data treatment is core, not decoration.

- **Subscription model**: one operator WebSocket (`/ws/operator`) carrying topic-scoped messages (`devices.upsert`, `aps.upsert`, `events.append`, `alerts.fire`). The `useLiveTopic(topic)` hook plus `useTanstackQuery` invalidation keeps state coherent — Query for source-of-truth lists, WS for nudges.
- **Fresh-data halo**: rows inserted or updated in the last 2 seconds get a 1px cyan left-border that fades to none over 1.5s. Never more than 2s of visual disturbance.
- **Number ticks**: KPI numbers tween 200ms when changed. If a number changes more than 10× per second (rare bursts), the tween is suppressed and the number jumps — anti-strobing.
- **Stale-data degradation**: any data older than 30s gets a mono "12s ago" label that turns amber, then red, then degrades the row to 60% opacity. Operators must never wonder if they're looking at live or frozen state.
- **Connection state**: if the operator WS drops, a slim 2px amber bar appears under the topbar with text "Reconnecting (3s)…". On recovery it goes green briefly then disappears. We never silently fail.
- **Backpressure**: if more than 50 events/sec are coming in, the live stream throttles to 50/sec on the wire with a small "throttled" badge — we never stall the browser.

---

## 10. Empty / loading / error / dangerous states

### Empty

Every list and detail surface has a designed empty state. Pattern: centred glyph (40% opacity) + headline + one-line body + (optional) CTA. **No raw "No data"** strings.

Example for `/sensors` with zero sensors:

> [glyph] **No sensors connected yet**
> Install the agent on your Raspberry Pi with the snippet below.
> `[Show install command]`

### Loading

`Skeleton` components only — same shape and dimensions as the loaded content. **Never** spinners on data surfaces. Pulse animation honours reduced-motion (becomes static).

### Error

Three tiers:

1. **Inline** (a field, a row): red `text-2xs` under the affected element with the error code.
2. **Toast** (transient): for actions that succeeded/failed without changing the viewable state.
3. **Page** (terminal): an `ErrorState` block — glyph + headline + body + `Try again` + `Copy request ID for support`. Always recoverable, always shows a request ID.

Errors include the backend correlation ID so the audit log can be cross-referenced.

### Dangerous (lab actions)

Every active-module action goes through `DangerConfirm`:

```
┌────────────────────────────────────────────────────┐
│  ⚠  Deauth target client                          │
│  ─────────────────────────────────────────────────│
│  Target:   a4:c3:f0:1d:88:0a  (Apple, iPhone-12) │  mono
│  Network:  CafeWiFi (2.4 GHz, ch 6)              │
│  Engagement: "Living room audit"                  │
│  LAB_MODE:  ENABLED (violet pill)                 │
│  On allow-list?  YES (added 12 min ago)           │
│                                                    │
│  Type the target MAC to confirm:                  │
│  [ ___________________________________ ]           │
│                                                    │
│  [Cancel]                       [Deauth target]   │  red button, disabled until match
└────────────────────────────────────────────────────┘
```

If any of `LAB_MODE` / authorized-operator ack / allow-list membership is missing, the action **isn't shown at all** — never shown-but-disabled. The route itself isn't reachable.

---

## 11. Accessibility

- **Keyboard**: every interactive element reachable with Tab; logical order; `:focus-visible` cyan glow ring (2px + 24px soft glow). Skip-to-main link on every page.
- **Screen reader**: every icon has `aria-label`; tables use proper `<th scope>` and `aria-sort`; live regions for toasts (`aria-live="polite"`) and reconnect banner (`aria-live="assertive"`).
- **Contrast**: WCAG AA minimum (4.5:1) on body text, AAA (7:1) on KPI numbers and headings.
- **Colour independence**: severity chips include text labels and icon shapes — never colour alone. Signal bars include the numeric dBm.
- **Motion**: every animation respects `prefers-reduced-motion`. Pulses become static; transitions collapse to instant.
- **Zoom**: layout holds to 200% browser zoom without horizontal scroll on `xl` viewport.
- **CI gate**: `axe-core` Playwright check on every primary route in CI. Zero violations to merge.

---

## 12. The "techy" effects budget — what we DO and DON'T

**DO** (used with discipline):

- Page-bg 32px grid texture at 4% opacity.
- Topbar scan line every 8s.
- Wordmark `//` live-pulse.
- Cyan focus glow on `:focus-visible`.
- Fresh-data halo (≤2s).
- Mono identifiers everywhere data is data.
- Lab-mode violet chrome shift.
- `xterm.js` console pane on sensor detail and lab modules (real terminal, not pastiche).

**DO NOT**:

- ❌ Matrix rain, glitch text, fake boot sequences, CRT curvature, faux scanlines on content.
- ❌ Pulsing/glowing buttons or cards at rest.
- ❌ Animated gradients, mesh gradients, decorative parallax, parallax scrolling.
- ❌ Sounds.
- ❌ "Hacker font" tropes (no OCR-B, no faux-LCD, no pixel fonts in UI chrome).
- ❌ Excessive Framer Motion — only for sheets/drawers/route transitions/toasts.
- ❌ Decorative neon edges on cards.

Rule of thumb: **if a competent SOC operator wouldn't take it seriously, cut it.**

---

## 13. Code organisation (apps/frontend)

```
apps/frontend/
├── public/
├── src/
│   ├── main.tsx                  # entry
│   ├── routes/                   # TanStack file-based routes
│   │   ├── __root.tsx
│   │   ├── login.tsx
│   │   ├── index.tsx             # /
│   │   ├── sensors.index.tsx
│   │   ├── sensors.$sensorId.tsx
│   │   ├── networks.index.tsx
│   │   ├── devices.index.tsx
│   │   ├── events.index.tsx
│   │   ├── alerts.index.tsx
│   │   ├── map.tsx
│   │   ├── engagements.index.tsx
│   │   ├── lab.index.tsx
│   │   ├── audit.tsx
│   │   ├── settings.account.tsx  ...etc
│   │   └── design-system.tsx     # internal showcase
│   ├── components/
│   │   ├── ui/                   # shadcn primitives
│   │   ├── domain/               # StatTile, LiveDot, SignalBars, etc.
│   │   ├── layout/               # AppShell, Sidebar, Topbar, …
│   │   ├── auth/
│   │   ├── branding/             # Glyph, Wordmark
│   │   ├── overview/             # OverviewKPIs, OverviewEventStream
│   │   ├── sensors/              # SensorList, SensorDetail, …
│   │   ├── networks/             …
│   │   ├── devices/              …
│   │   ├── events/               …
│   │   ├── alerts/               …
│   │   └── lab/                  …
│   ├── hooks/                    # useLiveTopic, useReducedMotion, useHotkey, …
│   ├── services/
│   │   ├── api/                  # OpenAPI-generated client wrapper
│   │   ├── ws/                   # operator websocket client
│   │   └── auth/                 # auth state, csrf, refresh
│   ├── stores/                   # Zustand (UI state only)
│   ├── styles/
│   │   ├── tokens.css
│   │   └── globals.css
│   ├── lib/                      # pure utilities, no React
│   ├── assets/                   # glyph.svg, fonts/
│   └── test/                     # msw handlers, fixtures, setup
├── tests/                        # e2e (Playwright)
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

**No file over 400 lines. No function over 50 lines.** Container components < 200 LoC; presentation components < 150 LoC. Hooks live alongside the component that owns them unless reused (`hooks/` is for shared).

---

## 14. Build order (the visible slice first)

Instead of "milestone 3 in one shot", I'll build it in five visible stages so you can react to the look early. Each stage ends with something you can `pnpm dev` and look at.

1. **Foundation** — Vite + TS strict + Tailwind 4 + tokens + fonts + shadcn primitives + glyph + wordmark + `/design-system` route showing every primitive and token in use. **You eyeball this first.**
2. **Shell** — `AppShell` + Sidebar + Topbar + CommandPalette + route stubs. No data yet — every route shows a designed empty state.
3. **Auth** — `/login` with TOTP, AuthGuard, session refresh, lab-mode chrome shift wired to a settings store.
4. **Overview + live data plumbing** — operator WebSocket client, `useLiveTopic` hook, KPI tiles, live event stream, signal histogram — running against msw fixtures while the backend catches up.
5. **Sensors + Networks + Devices** — three list/drawer pairs. By the end of this stage, milestone 3 is complete.

Tests, Lighthouse, axe-core all run from stage 1.

---

## 15. Operator guide deliverable

Every stage updates `docs/operator-guide.md` with annotated screenshots. The guide is written for an operator who has never opened the product before. PDF export is generated from this markdown in CI on tagged releases.
