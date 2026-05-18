import { Activity, Cpu, Radio } from "lucide-react";
import type { ReactNode } from "react";

const APP_VERSION = "v0.3.0";

interface BootLine {
  icon: typeof Activity;
  label: string;
  value: string;
  /** Visual tone for the value pill. */
  tone: "ok" | "wait";
}

/**
 * Static "system status" lines shown next to the brand on the login
 * scene. The values are decorative — the actual mTLS link and crypto
 * stack run inside the sensor agent and the backend respectively; this
 * panel just sets the tone for an operator-grade console.
 *
 * If/when we wire up a `GET /api/v1/health/login-context` style probe
 * to show real link state pre-auth, the right move is to swap this
 * array for a hook that returns the same shape.
 */
const BOOT_LINES: BootLine[] = [
  { icon: Cpu, label: "CRYPTO INIT", value: "OK", tone: "ok" },
  { icon: Radio, label: "MTLS LINK", value: "OK", tone: "ok" },
  { icon: Activity, label: "OPERATOR", value: "AWAITING", tone: "wait" },
];

interface LoginSceneProps {
  /** The login form (or 2FA challenge) goes inside the right-hand panel. */
  children: ReactNode;
}

/**
 * Full-bleed login chrome: drifting grid background, vertical scan
 * line, brand panel on the left, glass form panel on the right. Pure
 * visual frame — auth logic lives in {@link LoginForm}. The animated
 * layers all collapse to static under `prefers-reduced-motion` via the
 * global rule in `globals.css`.
 */
export function LoginScene({ children }: LoginSceneProps): JSX.Element {
  return (
    <div className="relative isolate flex min-h-screen w-full items-center justify-center overflow-hidden bg-bg-0 px-4 py-8 md:px-8">
      <BackgroundLayers />
      <main className="relative z-10 grid w-full max-w-5xl grid-cols-1 gap-8 md:grid-cols-[1.05fr_minmax(0,420px)] md:gap-12">
        <BrandPanel />
        <FormPanel>{children}</FormPanel>
      </main>
      <footer className="absolute inset-x-0 bottom-3 z-10 flex justify-center gap-3 px-4 text-2xs text-fg-40">
        <span className="font-mono">[ {APP_VERSION} ]</span>
        <span aria-hidden="true">·</span>
        <span className="uppercase tracking-wider">authorized testing only</span>
      </footer>
    </div>
  );
}

function BackgroundLayers(): JSX.Element {
  return (
    <>
      {/* Drifting grid — 32px cells at 4% opacity, animated diagonally
          so the surface never feels frozen. The wrapper is 200% wide
          and tiled so the translation never reveals an edge. */}
      <div
        aria-hidden="true"
        className="cp-grid-drift pointer-events-none absolute -inset-px"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--fg-100) / 0.04) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--fg-100) / 0.04) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />
      {/* Radial accent glow behind the brand cluster. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-32 top-1/3 size-[560px] -translate-y-1/2 rounded-full opacity-60 blur-3xl"
        style={{
          background: "radial-gradient(circle, hsl(var(--mode-accent) / 0.18) 0%, transparent 70%)",
        }}
      />
      {/* Vertical sweep — single 1px line drifting top-to-bottom every
          11s. Same idea as the existing cp-scanline but on the y axis
          to balance the horizontal one used elsewhere. */}
      <div aria-hidden="true" className="cp-vsweep" />
      {/* Vignette so the corners fade out into the page bg. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 40%, hsl(var(--bg-0) / 0.9) 100%)",
        }}
      />
    </>
  );
}

function BrandPanel(): JSX.Element {
  return (
    <section className="relative flex flex-col items-center gap-6 text-center md:items-start md:gap-7 md:text-left">
      <LogoWithGlow />
      <Wordmark />
      <p className="max-w-xs text-xs text-fg-60 md:max-w-sm md:text-sm">
        Operator-grade WiFi reconnaissance for authorized engagements. Sign in to continue.
      </p>
      <StatusReadout />
    </section>
  );
}

function LogoWithGlow(): JSX.Element {
  return (
    <div className="relative" data-testid="login-logo">
      <div
        aria-hidden="true"
        className="cp-logo-pulse pointer-events-none absolute inset-0 -m-8 rounded-full blur-2xl"
        style={{
          background: "radial-gradient(circle, hsl(var(--mode-accent) / 0.32) 0%, transparent 65%)",
        }}
      />
      <img
        src="/logo-256.png"
        srcSet="/logo-192.png 192w, /logo-256.png 256w, /logo-512.png 512w"
        sizes="160px"
        alt="Cheeky Pony"
        width={160}
        height={160}
        className="relative size-32 select-none md:size-40"
        draggable={false}
      />
    </div>
  );
}

function Wordmark(): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="font-display text-3xl font-semibold uppercase tracking-[0.18em] text-fg-100 md:text-4xl">
        CHEEKY
        <span className="mx-1 text-mode" aria-hidden="true">
          //
        </span>
        PONY
      </h1>
      <p className="text-2xs uppercase tracking-[0.32em] text-fg-60">operator console</p>
    </div>
  );
}

function StatusReadout(): JSX.Element {
  return (
    <ul
      className="flex w-full max-w-xs flex-col gap-1.5 rounded-sm border border-fg-20 bg-bg-inset/60 p-3 font-mono text-2xs text-fg-80 backdrop-blur md:max-w-sm"
      aria-label="System status"
      data-testid="login-status-readout"
    >
      {BOOT_LINES.map(({ icon: Icon, label, value, tone }) => (
        <li key={label} className="flex items-center gap-2">
          <Icon className="size-3 text-fg-60" aria-hidden="true" />
          <span className="text-fg-60">{label}</span>
          <span className="flex-1 self-end overflow-hidden text-fg-20">
            ─────────────────────────────
          </span>
          <span className={tone === "ok" ? "text-accent-green" : "text-accent-amber"}>{value}</span>
        </li>
      ))}
      <li className="flex items-center gap-2 pt-1 text-fg-40">
        <span aria-hidden="true">$</span>
        <span>standby</span>
        <span className="cp-cursor-blink ml-0.5 inline-block size-2 bg-mode" aria-hidden="true" />
      </li>
    </ul>
  );
}

function FormPanel({ children }: { children: ReactNode }): JSX.Element {
  return (
    <section className="relative">
      <CornerBrackets />
      <div className="relative rounded-md border border-fg-20 bg-bg-2/70 p-6 backdrop-blur-md md:p-7">
        <header className="mb-5 flex items-center gap-2 border-b border-fg-20 pb-3">
          <span className="size-1.5 rounded-full bg-mode shadow-[0_0_8px_hsl(var(--mode-accent))]" />
          <span className="font-mono text-2xs uppercase tracking-widest text-fg-60">
            authenticate
          </span>
          <span className="ml-auto font-mono text-2xs text-fg-40">/auth/login</span>
        </header>
        {children}
      </div>
    </section>
  );
}

function CornerBrackets(): JSX.Element {
  // Four absolute-positioned L-shapes; non-interactive, screen-reader
  // hidden. Uses the mode accent so it shifts to violet when LAB_MODE
  // is active. The border-color is set via inline style because
  // `globals.css` resets `* { border-color: var(--fg-20) }` outside
  // any cascade layer, which outranks Tailwind's `.border-mode`
  // utility (it lives inside `@layer utilities`).
  const arm = "absolute size-3.5";
  const colored: React.CSSProperties = { borderColor: "hsl(var(--mode-accent))" };
  return (
    <div aria-hidden="true" className="pointer-events-none absolute -inset-2">
      <span className={`${arm} left-0 top-0 border-l-2 border-t-2`} style={colored} />
      <span className={`${arm} right-0 top-0 border-r-2 border-t-2`} style={colored} />
      <span className={`${arm} bottom-0 left-0 border-b-2 border-l-2`} style={colored} />
      <span className={`${arm} bottom-0 right-0 border-b-2 border-r-2`} style={colored} />
    </div>
  );
}
