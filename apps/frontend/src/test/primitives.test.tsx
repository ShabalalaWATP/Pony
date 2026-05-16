import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AlertSeverityChip } from "@/components/domain/AlertSeverityChip";
import { ChannelBadge } from "@/components/domain/ChannelBadge";
import { EmptyState } from "@/components/domain/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";
import { Kbd } from "@/components/ui/Kbd";
import { Separator } from "@/components/ui/Separator";
import { Skeleton } from "@/components/ui/Skeleton";

describe("Badge", () => {
  it("renders its content", () => {
    render(<Badge>WPA3</Badge>);
    expect(screen.getByText("WPA3")).toBeInTheDocument();
  });

  it.each(["neutral", "accent", "cyan", "violet", "amber", "green", "red"] as const)(
    "supports the %s tone",
    (tone) => {
      const { container } = render(<Badge tone={tone}>x</Badge>);
      expect(container.firstChild).not.toBeNull();
    },
  );

  it("supports an outline variant", () => {
    const { container } = render(
      <Badge tone="cyan" outline>
        x
      </Badge>,
    );
    expect(container.firstChild).not.toBeNull();
  });
});

describe("Chip", () => {
  it("renders label and value", () => {
    render(<Chip label="band" value="5 GHz" />);
    expect(screen.getByText("band")).toBeInTheDocument();
    expect(screen.getByText("5 GHz")).toBeInTheDocument();
  });

  it("omits the value separator when value is absent", () => {
    render(<Chip label="status" />);
    expect(screen.queryByText("=")).toBeNull();
  });
});

describe("Kbd", () => {
  it("renders inside a <kbd> element", () => {
    const { container } = render(<Kbd>⌘K</Kbd>);
    expect(container.querySelector("kbd")?.textContent).toBe("⌘K");
  });
});

describe("Separator", () => {
  it("defaults to horizontal", () => {
    const { container } = render(<Separator />);
    expect(container.firstChild).toHaveAttribute("aria-orientation", "horizontal");
  });

  it("supports vertical orientation", () => {
    const { container } = render(<Separator orientation="vertical" />);
    expect(container.firstChild).toHaveAttribute("aria-orientation", "vertical");
  });
});

describe("Skeleton", () => {
  it("renders an aria-hidden div", () => {
    const { container } = render(<Skeleton className="h-4 w-10" />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });
});

describe("Input", () => {
  it("renders text input by default", () => {
    render(<Input placeholder="Search" />);
    expect(screen.getByPlaceholderText("Search")).toHaveAttribute("type", "text");
  });

  it("forwards the type prop", () => {
    render(<Input type="email" placeholder="Email" />);
    expect(screen.getByPlaceholderText("Email")).toHaveAttribute("type", "email");
  });
});

describe("AlertSeverityChip", () => {
  it.each(["critical", "high", "medium", "low", "info"] as const)("renders %s", (severity) => {
    render(<AlertSeverityChip severity={severity} />);
    const expected = severity[0]!.toUpperCase() + severity.slice(1);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});

describe("ChannelBadge", () => {
  it("renders channel + band", () => {
    render(<ChannelBadge channel={6} band="2.4" />);
    expect(screen.getByText("ch 6")).toBeInTheDocument();
    expect(screen.getByText("2.4GHz")).toBeInTheDocument();
  });

  it.each([
    [6, "2.4GHz"],
    [36, "5GHz"],
    [185, "6GHz"],
  ])("infers band for channel %i as %s", (channel, expectedBand) => {
    render(<ChannelBadge channel={channel} />);
    expect(screen.getByText(expectedBand)).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders title and optional description / action", () => {
    render(
      <EmptyState title="Nothing yet" description="Add a sensor" action={<button>Add</button>} />,
    );
    expect(screen.getByRole("heading", { name: "Nothing yet" })).toBeInTheDocument();
    expect(screen.getByText("Add a sensor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("renders without optional props", () => {
    render(<EmptyState title="Empty" />);
    expect(screen.getByRole("heading", { name: "Empty" })).toBeInTheDocument();
  });
});
