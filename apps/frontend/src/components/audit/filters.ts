import type { components } from "@/services/api/openapi";

type AuditLog = components["schemas"]["AuditLog"];

/**
 * Outcome filter chips on `/audit`. `denied` matches any outcome
 * that starts with `denied:` (the convention the backend uses for
 * structured refusals); `ok` matches the literal value.
 */
export type AuditOutcomeFilter = "denied" | "ok";

/**
 * Compute the action-prefix set (`<top>.<sub>`) for the current
 * page so the filter chip strip stays in sync with the data instead
 * of a hard-coded list that would drift from the backend.
 */
export function collectActionPrefixes(items: AuditLog[]): string[] {
  const set = new Set<string>();
  for (const row of items) {
    const parts = row.action.split(".");
    if (parts.length >= 2) set.add(`${parts[0]}.${parts[1]}`);
    else set.add(row.action);
  }
  return [...set].sort();
}

/**
 * Pure filter applied client-side to the loaded audit page. Kept
 * exported so the unit tests can hit it directly without spinning
 * up a full DataTable render.
 */
export function filterAudit(
  items: AuditLog[],
  action: string | undefined,
  outcome: AuditOutcomeFilter | undefined,
): AuditLog[] {
  return items.filter((row) => {
    if (action !== undefined && !row.action.startsWith(action)) return false;
    if (outcome === "denied" && !row.outcome.startsWith("denied:")) return false;
    if (outcome === "ok" && row.outcome !== "ok") return false;
    return true;
  });
}

/**
 * Map an audit `outcome` to a badge tone. The backend uses
 * conventional `:`-separated suffixes (`denied:lab_mode_disabled`,
 * `denied:target_not_in_allowlist`, etc) so we tone everything
 * starting with `denied:` red, success-y values green, neutral
 * otherwise.
 */
export function outcomeTone(outcome: string): "green" | "red" | "amber" | "neutral" {
  if (outcome.startsWith("denied:")) return "red";
  if (outcome === "ok" || outcome === "started" || outcome === "accepted") return "green";
  if (outcome === "stop_requested" || outcome === "in_progress") return "amber";
  return "neutral";
}
