import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AboutView } from "@/components/settings/AboutView";

describe("AboutView", () => {
  it("renders the brand mark + tagline", () => {
    render(<AboutView />);
    expect(screen.getByRole("img", { name: /cheeky pony/i })).toBeInTheDocument();
    expect(screen.getByText(/operator dashboard/i)).toBeInTheDocument();
  });

  it("renders version + license + build mode metadata", () => {
    render(<AboutView />);
    const meta = screen.getByTestId("about-metadata");
    expect(meta).toHaveTextContent(/version/i);
    expect(meta).toHaveTextContent(/agpl-3\.0-only/i);
    expect(meta).toHaveTextContent(/build mode/i);
  });

  it("renders the documentation link list with safe external attributes", () => {
    render(<AboutView />);
    // Doc-link buttons are <a> tags; verify rel + target are correct so
    // we don't get window.opener / tabnabbing leakage.
    const links = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.includes("ShabalalaWATP/Pony"));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link.getAttribute("rel") ?? "").toMatch(/noreferrer/);
      expect(link.getAttribute("rel") ?? "").toMatch(/noopener/);
    }
  });

  it("links to README, SECURITY, and LICENSE", () => {
    render(<AboutView />);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.endsWith("/README.md"))).toBe(true);
    expect(hrefs.some((h) => h.endsWith("/SECURITY.md"))).toBe(true);
    expect(hrefs.some((h) => h.endsWith("/LICENSE"))).toBe(true);
  });
});
