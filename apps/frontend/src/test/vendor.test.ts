import { describe, expect, it } from "vitest";
import { resolveVendor } from "@/lib/vendor";

describe("resolveVendor", () => {
  it("prefers vendor_resolved over vendor_oui when both are present", () => {
    expect(
      resolveVendor({
        vendor_resolved: "Samsung Electronics Co., Ltd",
        vendor_oui: "Synthetic",
      }),
    ).toBe("Samsung Electronics Co., Ltd");
  });

  it("falls back to vendor_oui when vendor_resolved is null", () => {
    expect(resolveVendor({ vendor_resolved: null, vendor_oui: "Apple" })).toBe("Apple");
  });

  it("falls back to vendor_oui when vendor_resolved is undefined", () => {
    expect(resolveVendor({ vendor_oui: "Apple" })).toBe("Apple");
  });

  it("returns undefined when both fields are missing or null", () => {
    expect(resolveVendor({})).toBeUndefined();
    expect(resolveVendor({ vendor_resolved: null, vendor_oui: null })).toBeUndefined();
  });

  it("treats empty string as a value (caller's choice), not undefined", () => {
    expect(resolveVendor({ vendor_resolved: "" })).toBe("");
  });
});
