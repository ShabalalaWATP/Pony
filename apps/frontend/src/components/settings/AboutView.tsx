import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { Separator } from "@/components/ui/Separator";

/**
 * Build/release metadata baked into the bundle. Vite replaces the
 * `import.meta.env.*` references at compile time; everything here is
 * a string literal in production so the operator never sees a
 * mid-render rebind.
 */
const VERSION = "0.4.0";
const LICENSE = "AGPL-3.0-only";
const MODE = import.meta.env.MODE;
const REPO_URL = "https://github.com/ShabalalaWATP/Pony";

interface AboutLink {
  href: string;
  label: string;
}

const DOC_LINKS: AboutLink[] = [
  { href: `${REPO_URL}/blob/main/README.md`, label: "README" },
  { href: `${REPO_URL}/blob/main/SECURITY.md`, label: "Responsible disclosure" },
  { href: `${REPO_URL}/blob/main/docs/architecture.md`, label: "Architecture" },
  { href: `${REPO_URL}/blob/main/docs/threat-model.md`, label: "Threat model" },
  { href: `${REPO_URL}/blob/main/LICENSE`, label: "License" },
];

/**
 * Static About page. Surfaces the version, license, and the
 * canonical doc links so operators can find the runbooks without
 * leaving the app.
 *
 * No network calls, no state — pure render. Keeping it dependency-
 * free means the page also works as a "first thing to check"
 * fallback when half the backend is down.
 */
export function AboutView(): JSX.Element {
  return (
    <div className="flex flex-col gap-6" data-testid="settings-about">
      <PageHeader title="About" />

      <section className="flex flex-wrap items-center gap-3 rounded-md border border-fg-20 bg-bg-2 p-5">
        <img
          src="/logo-192.png"
          srcSet="/logo-192.png 192w, /logo-256.png 256w"
          sizes="96px"
          alt="Cheeky Pony"
          width={96}
          height={96}
          className="size-24"
          draggable={false}
        />
        <div className="flex flex-col gap-1">
          <div className="font-display text-xl font-semibold tracking-tight text-fg-100">
            Cheeky Pony
          </div>
          <p className="max-w-prose text-xs text-fg-60">
            Operator dashboard for distributed WiFi reconnaissance. Self-hosted; every active module
            is gated behind LAB_MODE + an authorized-operator acknowledgement + an active engagement
            allow-list.
          </p>
        </div>
      </section>

      <section
        className="grid grid-cols-1 gap-3 sm:grid-cols-[140px_1fr]"
        data-testid="about-metadata"
      >
        <div className="text-2xs uppercase tracking-wide text-fg-60">Version</div>
        <div className="font-mono text-sm text-fg-100">{VERSION}</div>

        <div className="text-2xs uppercase tracking-wide text-fg-60">License</div>
        <div className="text-sm text-fg-100">
          <Badge tone="violet" outline>
            {LICENSE}
          </Badge>
        </div>

        <div className="text-2xs uppercase tracking-wide text-fg-60">Build mode</div>
        <div className="font-mono text-xs text-fg-80">{MODE}</div>

        <div className="text-2xs uppercase tracking-wide text-fg-60">Source</div>
        <div className="font-mono text-xs text-fg-80">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-mode hover:underline"
          >
            {REPO_URL}
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-2">
        <div className="text-2xs uppercase tracking-wide text-fg-60">Documentation</div>
        <ul className="flex flex-wrap gap-2">
          {DOC_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 rounded-sm border border-fg-20 bg-bg-2 px-2 py-1 text-xs text-fg-100 hover:border-fg-40 hover:text-mode"
              >
                {link.label}
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      </section>

      <Separator />

      <section className="flex flex-col gap-2 text-xs text-fg-60">
        <p>
          Cheeky Pony refuses to load active modules until every gate in
          <code className="mx-1 rounded-sm bg-bg-2 px-1 py-0.5 font-mono text-2xs">
            /settings/system
          </code>
          is green. This is by design — see the architecture + threat-model docs above for
          background.
        </p>
        <p>
          Built for authorised testing on networks you own or have written permission to assess.
        </p>
      </section>
    </div>
  );
}
