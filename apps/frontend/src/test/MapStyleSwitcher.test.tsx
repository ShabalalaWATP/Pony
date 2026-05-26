import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MapStyleSwitcher } from "@/components/map/MapStyleSwitcher";
import { MAP_STYLES, styleDefFor, type MapStyleId } from "@/components/map/mapStyles";
import { useMapStyleStore } from "@/stores/useMapStyleStore";

describe("MapStyleSwitcher", () => {
  beforeEach(() => {
    void act(() => useMapStyleStore.setState({ styleId: "street" }));
  });
  afterEach(() => {
    void act(() => useMapStyleStore.setState({ styleId: "street" }));
  });

  it("renders one labelled button per entry in MAP_STYLES", () => {
    render(<MapStyleSwitcher />);
    for (const s of MAP_STYLES) {
      expect(screen.getByTestId(`map-style-${s.id}`)).toBeInTheDocument();
    }
  });

  it("marks the current selection with aria-pressed", () => {
    void act(() => useMapStyleStore.setState({ styleId: "satellite" }));
    render(<MapStyleSwitcher />);
    expect(screen.getByTestId("map-style-satellite")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("map-style-street")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("map-style-hybrid")).toHaveAttribute("aria-pressed", "false");
  });

  it("updates the store when a different option is clicked", async () => {
    render(<MapStyleSwitcher />);
    await userEvent.click(screen.getByTestId("map-style-hybrid"));
    expect(useMapStyleStore.getState().styleId).toBe("hybrid");
  });

  it("exposes a single group with an accessible label", () => {
    render(<MapStyleSwitcher />);
    expect(screen.getByRole("group", { name: /map base layer/i })).toBeInTheDocument();
  });
});

describe("mapStyles catalogue", () => {
  it("does not expose remote tile or style URLs by default", () => {
    for (const s of MAP_STYLES) {
      if (typeof s.style === "string") {
        expect(s.style).not.toMatch(/^https?:\/\//);
        continue;
      }
      for (const source of Object.values(s.style.sources)) {
        if ("tiles" in source && source.tiles) {
          for (const url of source.tiles) {
            expect(url).not.toMatch(/^https?:\/\//);
          }
        }
      }
    }
  });

  it("styleDefFor falls back to Street for an unknown id", () => {
    const unknown = "wat" as MapStyleId;
    expect(styleDefFor(unknown).id).toBe("street");
  });
});

describe("useMapStyleStore", () => {
  beforeEach(() => {
    void act(() => useMapStyleStore.setState({ styleId: "street" }));
  });

  it("rejects unknown style ids (defensive against stale localStorage)", () => {
    useMapStyleStore.getState().setStyleId("not-a-style" as MapStyleId);
    expect(useMapStyleStore.getState().styleId).toBe("street");
  });

  it("accepts every catalogued id", () => {
    for (const s of MAP_STYLES) {
      useMapStyleStore.getState().setStyleId(s.id);
      expect(useMapStyleStore.getState().styleId).toBe(s.id);
    }
  });
});
