/**
 * Operator-friendly vendor name for a MAC-bearing record.
 *
 * Prefers the backend-resolved vendor (PR #57's `vendor_resolved`,
 * which looks up the OUI prefix against the embedded Wireshark
 * manuf table) over the stored `vendor_oui` field. Stored values
 * are commonly something noisy like `"Synthetic"` on demo data or
 * may be missing entirely on records ingested before the resolver
 * existed; falling back to them lets the UI degrade gracefully.
 *
 * Returns `undefined` rather than `null` so it slots straight into
 * the existing `vendor?: string` prop on `<MacAddress>` without
 * extra coalescing at every call site.
 */
export interface VendorBearing {
  vendor_resolved?: string | null;
  vendor_oui?: string | null;
}

export function resolveVendor(item: VendorBearing): string | undefined {
  return item.vendor_resolved ?? item.vendor_oui ?? undefined;
}
