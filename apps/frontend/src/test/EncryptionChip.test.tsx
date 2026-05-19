import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EncryptionChip } from "@/components/domain/EncryptionChip";

describe("EncryptionChip", () => {
  it.each([
    ["WPA3", "WPA3"],
    ["WPA2-PSK", "WPA2"],
    ["WPA-PSK", "WPA"],
    ["WEP", "WEP"],
    ["NONE", "Open"],
    ["", "Open"],
  ])("classifies %s as %s", (input, expected) => {
    render(<EncryptionChip encryption={input} />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});
