import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useMapPinsStore } from "@/stores/useMapPinsStore";

describe("useMapPinsStore", () => {
  beforeEach(() => {
    useMapPinsStore.setState({ pins: {} });
  });
  afterEach(() => {
    useMapPinsStore.setState({ pins: {} });
    window.localStorage.removeItem("cp-map-pins");
  });

  it("sets a pin by BSSID (normalised to lower-case)", () => {
    useMapPinsStore.getState().setPin("A4:C3:F0:1D:88:0A", { lat: 51.5, lng: -0.1 });
    const pins = useMapPinsStore.getState().pins;
    expect(pins["a4:c3:f0:1d:88:0a"]).toEqual({ lat: 51.5, lng: -0.1 });
  });

  it("overwrites a pin on a second setPin with the same BSSID", () => {
    const { setPin } = useMapPinsStore.getState();
    setPin("aa:bb:cc:dd:ee:01", { lat: 1, lng: 2 });
    setPin("aa:bb:cc:dd:ee:01", { lat: 3, lng: 4, note: "moved" });
    expect(useMapPinsStore.getState().pins["aa:bb:cc:dd:ee:01"]).toEqual({
      lat: 3,
      lng: 4,
      note: "moved",
    });
  });

  it("removes a pin by BSSID", () => {
    const { setPin, removePin } = useMapPinsStore.getState();
    setPin("aa:bb:cc:dd:ee:01", { lat: 1, lng: 2 });
    setPin("aa:bb:cc:dd:ee:02", { lat: 3, lng: 4 });
    removePin("aa:bb:cc:dd:ee:01");
    const pins = useMapPinsStore.getState().pins;
    expect(pins["aa:bb:cc:dd:ee:01"]).toBeUndefined();
    expect(pins["aa:bb:cc:dd:ee:02"]).toEqual({ lat: 3, lng: 4 });
  });

  it("clear() empties the pin set", () => {
    const { setPin, clear } = useMapPinsStore.getState();
    setPin("aa:bb:cc:dd:ee:01", { lat: 1, lng: 2 });
    setPin("aa:bb:cc:dd:ee:02", { lat: 3, lng: 4 });
    clear();
    expect(Object.keys(useMapPinsStore.getState().pins)).toHaveLength(0);
  });
});
