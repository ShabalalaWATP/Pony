/**
 * Form-row representation used inside the create-engagement drawer.
 * Each row owns a stable `rowKey` so React can track adds/removes
 * across re-renders without colliding on duplicate field names.
 */
export interface ScopeRow {
  rowKey: string;
  field: string;
  value: string;
}

/**
 * Drop blank rows and collapse each row into the `{[field]: value}`
 * shape the backend expects. Exported so unit tests can verify the
 * trim/drop behaviour without spinning up the drawer.
 */
export function collectScopeRules(rules: ScopeRow[]): Record<string, string>[] | undefined {
  const cleaned = rules
    .map((row) => ({ field: row.field.trim(), value: row.value.trim() }))
    .filter((row) => row.field !== "" && row.value !== "")
    .map((row) => ({ [row.field]: row.value }));
  return cleaned.length > 0 ? cleaned : undefined;
}
