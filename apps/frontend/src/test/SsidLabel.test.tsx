import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SsidLabel } from "@/components/domain/SsidLabel";

describe("SsidLabel", () => {
  it("renders the SSID verbatim when present", () => {
    render(<SsidLabel ssid="MyHomeNetwork" />);
    expect(screen.getByText("MyHomeNetwork")).toBeInTheDocument();
  });

  it("renders '<hidden>' for null SSID, italic muted", () => {
    render(<SsidLabel ssid={null} testId="ssid" />);
    const el = screen.getByTestId("ssid");
    expect(el).toHaveTextContent("<hidden>");
    expect(el).toHaveClass("italic", "text-fg-40");
  });

  it("treats empty string and undefined the same as null", () => {
    const { rerender } = render(<SsidLabel ssid="" testId="ssid" />);
    expect(screen.getByTestId("ssid")).toHaveTextContent("<hidden>");
    rerender(<SsidLabel ssid={undefined} testId="ssid" />);
    expect(screen.getByTestId("ssid")).toHaveTextContent("<hidden>");
  });

  it("opts into truncation when requested", () => {
    render(<SsidLabel ssid="x" truncate testId="ssid" />);
    expect(screen.getByTestId("ssid")).toHaveClass("truncate");
  });

  it("merges caller-supplied className with the built-in palette", () => {
    render(<SsidLabel ssid="x" className="font-mono" testId="ssid" />);
    const el = screen.getByTestId("ssid");
    expect(el).toHaveClass("font-mono");
    expect(el).toHaveClass("text-fg-100");
  });
});
