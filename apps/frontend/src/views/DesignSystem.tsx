import { Settings, Wifi } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Glyph } from "@/components/branding/Glyph";
import { Wordmark } from "@/components/branding/Wordmark";
import { AlertSeverityChip } from "@/components/domain/AlertSeverityChip";
import { ChannelBadge } from "@/components/domain/ChannelBadge";
import { EmptyState } from "@/components/domain/EmptyState";
import { EncryptionChip } from "@/components/domain/EncryptionChip";
import { LiveDot } from "@/components/domain/LiveDot";
import { MacAddress } from "@/components/domain/MacAddress";
import { RelativeTime } from "@/components/domain/RelativeTime";
import { SignalBars } from "@/components/domain/SignalBars";
import { SignalSparkline } from "@/components/domain/SignalSparkline";
import { StatTile } from "@/components/domain/StatTile";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";
import { Kbd } from "@/components/ui/Kbd";
import { Separator } from "@/components/ui/Separator";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tooltip } from "@/components/ui/Tooltip";
import { MockTopbar } from "./designSystem/MockTopbar";
import { Section, Swatch } from "./designSystem/sections";

const SAMPLE_SPARKLINE = [
  -82, -78, -76, -73, -71, -70, -68, -65, -64, -62, -61, -63, -66, -64, -62, -60, -58, -57, -59,
  -61,
];

export function DesignSystem(): JSX.Element {
  const [labMode, setLabMode] = useState(false);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    document.documentElement.dataset.labMode = String(labMode);
    return () => {
      delete document.documentElement.dataset.labMode;
    };
  }, [labMode]);

  const toggleLabMode = useCallback(() => setLabMode((v) => !v), []);

  return (
    <div className="min-h-screen bg-bg-0">
      <MockTopbar labMode={labMode} />

      <main className="mx-auto max-w-6xl px-8 py-12">
        <header className="mb-12">
          <div className="flex items-baseline gap-3">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-fg-100">
              Design System
            </h1>
            <Badge tone="accent" outline>
              Stage 1
            </Badge>
          </div>
          <p className="mt-3 max-w-prose text-sm text-fg-60">
            The visual identity of <Wordmark className="inline-flex text-sm" forceState="live" />.
            Source of truth for tokens, primitives, and interaction patterns —{" "}
            <code className="font-mono text-fg-80">docs/frontend-design.md</code>.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button variant={labMode ? "primary" : "secondary"} onClick={toggleLabMode}>
              <Wifi className="size-4" aria-hidden="true" />
              {labMode ? "Disengage Lab Mode" : "Engage Lab Mode"}
            </Button>
            <span className="text-xs text-fg-60">
              Toggle to preview the violet chrome shift applied to active modules.
            </span>
          </div>
        </header>

        <Section
          title="Brand"
          description="Tracking-diamond glyph + CHEEKY//PONY wordmark. The // pulses live; reduced-motion users get the colour without the animation."
        >
          <div className="flex flex-wrap items-end gap-12">
            <div className="flex flex-col items-center gap-3">
              <Glyph className="size-20 text-mode" />
              <code className="font-mono text-2xs text-fg-40">80px</code>
            </div>
            <div className="flex flex-col items-center gap-3">
              <Glyph className="size-10 text-mode" />
              <code className="font-mono text-2xs text-fg-40">40px</code>
            </div>
            <div className="flex flex-col items-center gap-3">
              <Glyph className="size-6 text-mode" />
              <code className="font-mono text-2xs text-fg-40">24px</code>
            </div>
            <div className="flex flex-col items-center gap-3">
              <Glyph className="size-4 text-mode" compact />
              <code className="font-mono text-2xs text-fg-40">16px · compact</code>
            </div>
            <Separator orientation="vertical" className="h-20" />
            <div className="flex flex-col gap-3">
              <Wordmark forceState="live" />
              <Wordmark forceState="stale" />
              <code className="font-mono text-2xs text-fg-40">live · stale</code>
            </div>
          </div>
        </Section>

        <Section
          title="Surfaces"
          description="The five canvas treatments. Never improvise a sixth."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Swatch name="bg-0 (page)" varName="--bg-0" />
            <Swatch name="bg-1 (surface)" varName="--bg-1" />
            <Swatch name="bg-2 (card)" varName="--bg-2" />
            <Swatch name="bg-3 (chrome)" varName="--bg-3" />
            <Swatch name="bg-inset (console)" varName="--bg-inset" />
          </div>
        </Section>

        <Section
          title="Foreground"
          description="Text colour ramp. Never put body text below fg-80 on bg-1+."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Swatch name="fg-100" varName="--fg-100" />
            <Swatch name="fg-80" varName="--fg-80" />
            <Swatch name="fg-60" varName="--fg-60" />
            <Swatch name="fg-40" varName="--fg-40" />
            <Swatch name="fg-20 (divider)" varName="--fg-20" />
          </div>
        </Section>

        <Section
          title="Accents"
          description="Used sparingly. Rule of thumb: ≤ 8% saturated colour per viewport."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Swatch name="cyan (primary)" varName="--accent-cyan" />
            <Swatch name="violet (lab)" varName="--accent-violet" />
            <Swatch name="amber (warn)" varName="--accent-amber" />
            <Swatch name="red (critical)" varName="--accent-red" />
            <Swatch name="green (healthy)" varName="--accent-green" />
          </div>
        </Section>

        <Section
          title="Type scale"
          description="Sans for prose, mono for data. Mixing fonts is how data communicates 'I'm a value, not a label.'"
        >
          <div className="flex flex-col gap-4">
            <div className="text-2xl text-fg-100">Page title · 30 / 38</div>
            <div className="text-xl text-fg-100">Section title · 24 / 32</div>
            <div className="text-lg text-fg-100">Heading · 19 / 28</div>
            <div className="text-md text-fg-100">Subheading · 16 / 24</div>
            <div className="text-base text-fg-100">Primary body · 14 / 22</div>
            <div className="text-sm text-fg-80">Default body · 13 / 20</div>
            <div className="text-xs text-fg-60">Secondary · 12 / 18</div>
            <div className="text-2xs uppercase tracking-wide text-fg-60">
              Caption / table header · 11 / 16
            </div>
            <Separator className="my-2" />
            <div className="font-mono text-base text-fg-100">a4:c3:f0:1d:88:0a — mono base</div>
            <div className="font-mono text-xs text-fg-80">2026-05-16T14:32:18.421Z — mono xs</div>
          </div>
        </Section>

        <Section
          title="Buttons"
          description="Variants × sizes. Primary inherits the mode-accent so it shifts violet in lab mode."
        >
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary">Primary action</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
              <Button variant="link">Link style</Button>
              <Button disabled>Disabled</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
              <Button size="icon" variant="ghost" aria-label="Open settings">
                <Settings className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </Section>

        <Section title="Inputs & filters">
          <div className="flex flex-col gap-4">
            <div className="grid max-w-xl gap-3 sm:grid-cols-2">
              <Input placeholder="Email address" />
              <Input mono placeholder="a4:c3:f0:1d:88:0a" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Chip label="encryption" value="WPA3" />
              <Chip label="band" value="5 GHz" />
              <Chip label="bssid" value="a4:c3:…:0a" mono />
              <Chip label="last_seen" value="< 5m" />
            </div>
          </div>
        </Section>

        <Section title="Badges & severity">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">Neutral</Badge>
              <Badge tone="accent">Accent</Badge>
              <Badge tone="cyan">Cyan</Badge>
              <Badge tone="violet">Violet</Badge>
              <Badge tone="amber">Amber</Badge>
              <Badge tone="green">Green</Badge>
              <Badge tone="red">Red</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral" outline>
                Neutral
              </Badge>
              <Badge tone="accent" outline>
                Accent
              </Badge>
              <Badge tone="cyan" outline>
                Cyan
              </Badge>
              <Badge tone="amber" outline>
                Amber
              </Badge>
              <Badge tone="red" outline>
                Red
              </Badge>
            </div>
            <Separator />
            <div className="flex flex-wrap items-center gap-2">
              <AlertSeverityChip severity="critical" />
              <AlertSeverityChip severity="high" />
              <AlertSeverityChip severity="medium" />
              <AlertSeverityChip severity="low" />
              <AlertSeverityChip severity="info" />
            </div>
          </div>
        </Section>

        <Section title="Status & live data">
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-6">
              <LiveDot state="live" />
              <LiveDot state="stale" />
              <LiveDot state="offline" />
            </div>
            <Separator />
            <div className="flex flex-wrap items-center gap-6">
              <RelativeTime value={now - 4_000} />
              <RelativeTime value={now - 64_000} />
              <RelativeTime value={now - 800_000} />
            </div>
          </div>
        </Section>

        <Section title="Network primitives">
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-end gap-6">
              <SignalBars dbm={-48} />
              <SignalBars dbm={-62} />
              <SignalBars dbm={-74} />
              <SignalBars dbm={-83} />
              <SignalBars dbm={-92} />
            </div>
            <Separator />
            <div className="flex flex-wrap items-center gap-6">
              <SignalSparkline samples={SAMPLE_SPARKLINE} />
              <SignalSparkline samples={SAMPLE_SPARKLINE} tone="green" />
              <SignalSparkline samples={SAMPLE_SPARKLINE.slice().reverse()} tone="red" />
              <SignalSparkline samples={[]} />
            </div>
            <Separator />
            <div className="flex flex-wrap items-center gap-3">
              <EncryptionChip encryption="WPA3" />
              <EncryptionChip encryption="WPA2" />
              <EncryptionChip encryption="WPA" />
              <EncryptionChip encryption="WEP" />
              <EncryptionChip encryption="OPEN" />
              <ChannelBadge channel={6} />
              <ChannelBadge channel={36} />
              <ChannelBadge channel={149} />
            </div>
            <Separator />
            <div className="flex flex-wrap items-center gap-6">
              <MacAddress value="a4:c3:f0:1d:88:0a" vendor="Apple" />
              <MacAddress value="38:c9:86:1c:33:a2" vendor="Samsung Electronics" />
              <MacAddress value="b8:27:eb:99:c1:4d" vendor="Raspberry Pi Foundation" truncate />
            </div>
          </div>
        </Section>

        <Section
          title="KPI tiles"
          description="Hero numbers for the overview. Mono value, label uppercase, delta + sparkline bottom-right."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatTile label="Devices online" value="1 482" delta={+128} trend={SAMPLE_SPARKLINE} />
            <StatTile label="Access points" value="312" delta={+12} trend={SAMPLE_SPARKLINE} />
            <StatTile
              label="Open alerts"
              value="3"
              delta={-2}
              trend={SAMPLE_SPARKLINE.slice().reverse()}
            />
          </div>
        </Section>

        <Section
          title="States"
          description="Loading and empty surfaces. No spinners on data, no raw 'no data' strings."
        >
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-md border border-fg-20 bg-bg-2 p-4">
              <div className="mb-4 text-2xs uppercase tracking-wide text-fg-60">
                Skeleton (loading)
              </div>
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            </div>
            <div className="rounded-md border border-fg-20 bg-bg-2">
              <EmptyState
                title="No sensors connected yet"
                description="Run the install snippet on your Raspberry Pi to bring your first sensor online."
                action={<Button variant="primary">Show install command</Button>}
              />
            </div>
          </div>
        </Section>

        <Section title="Tooltips & keys">
          <div className="flex flex-wrap items-center gap-6">
            <Tooltip content="Acknowledge top alert">
              <Button variant="ghost">Hover me</Button>
            </Tooltip>
            <div className="flex items-center gap-1.5 text-xs text-fg-60">
              <span>Open palette</span>
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-fg-60">
              <span>Go to sensors</span>
              <Kbd>g</Kbd>
              <Kbd>s</Kbd>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-fg-60">
              <span>Cheat sheet</span>
              <Kbd>?</Kbd>
            </div>
          </div>
        </Section>

        <footer className="mt-8 flex items-center justify-between gap-4 text-2xs text-fg-40">
          <span>
            <Glyph className="mr-1 inline-block size-3 align-[-2px] text-fg-40" /> Cheeky Pony ·
            Stage 1 · v0.1.0
          </span>
          <span className="font-mono">{new Date(now).toISOString()}</span>
        </footer>
      </main>
    </div>
  );
}
