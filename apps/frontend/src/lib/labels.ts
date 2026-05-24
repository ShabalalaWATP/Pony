import type { components } from "@/services/api/openapi";

export type ApType = components["schemas"]["ApType"];
export type DeviceClass = components["schemas"]["DeviceClass"];
export type DerivedLabel = ApType | DeviceClass;

/**
 * Badge tone (matches `Badge` component's `tone` variant) + the
 * human-readable text to render for a given derived label.
 *
 * Labels are produced server-side by the local classifiers in
 * `cheeky_pony_backend.domain.labelling` (PR #58). Weak classifications
 * fall back to `"unknown"` server-side via the
 * `CHEEKY_PONY_LABEL_CONFIDENCE_THRESHOLD` setting, so the frontend
 * does NOT need to apply its own threshold — `unknown` is the canonical
 * "no useful classification" sentinel and is rendered as nothing.
 */
export interface LabelDisplay {
  tone: "accent" | "cyan" | "violet" | "amber" | "green" | "neutral";
  display: string;
}

const AP_LABELS: Record<ApType, LabelDisplay> = {
  corporate: { tone: "cyan", display: "Corporate" },
  public: { tone: "amber", display: "Public" },
  mobile_hotspot: { tone: "green", display: "Hotspot" },
  iot: { tone: "violet", display: "IoT" },
  personal: { tone: "neutral", display: "Personal" },
  unknown: { tone: "neutral", display: "Unknown" },
};

const DEVICE_LABELS: Record<DeviceClass, LabelDisplay> = {
  mobile: { tone: "cyan", display: "Mobile" },
  laptop: { tone: "green", display: "Laptop" },
  iot: { tone: "violet", display: "IoT" },
  wearable: { tone: "amber", display: "Wearable" },
  unknown: { tone: "neutral", display: "Unknown" },
};

export function describeApLabel(label: ApType): LabelDisplay {
  return AP_LABELS[label] ?? AP_LABELS.unknown;
}

export function describeDeviceLabel(label: DeviceClass): LabelDisplay {
  return DEVICE_LABELS[label] ?? DEVICE_LABELS.unknown;
}

/**
 * True when the label is `unknown` — operator surfaces should skip
 * rendering rather than show a noisy "Unknown" chip on every row.
 */
export function isMeaningfulLabel(label: DerivedLabel | null | undefined): boolean {
  return Boolean(label) && label !== "unknown";
}
