import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  type AlertRule,
  type AlertRuleCreateRequest,
  type AlertRuleUpdateRequest,
  type AlertSeverity,
} from "@/services/api/queries";

const SEVERITIES: AlertSeverity[] = ["info", "low", "medium", "high", "critical"];

interface AlertRuleFormProps {
  initial?: AlertRule;
  busy?: boolean;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (payload: AlertRuleCreateRequest | AlertRuleUpdateRequest) => void;
}

interface FormState {
  name: string;
  description: string;
  severity: AlertSeverity;
  enabled: boolean;
  predicate: string;
}

function emptyState(): FormState {
  return {
    name: "",
    description: "",
    severity: "medium",
    enabled: true,
    predicate: JSON.stringify({ event_kind: "access_point_seen" }, null, 2),
  };
}

function fromRule(rule: AlertRule): FormState {
  return {
    name: rule.name,
    description: rule.description ?? "",
    severity: rule.severity,
    enabled: rule.enabled,
    predicate: JSON.stringify(rule.predicate, null, 2),
  };
}

/**
 * Create / edit form for an `AlertRule`. The predicate is edited as raw
 * JSON; we parse + reject non-object payloads on submit so callers
 * never see a `predicate: 5` reach the backend. The component is
 * controlled-only and stateless across re-mounts — callers control the
 * `initial` prop to swap which rule is being edited.
 */
export function AlertRuleForm({
  initial,
  busy = false,
  submitLabel,
  onCancel,
  onSubmit,
}: AlertRuleFormProps): JSX.Element {
  const [state, setState] = useState<FormState>(() => (initial ? fromRule(initial) : emptyState()));
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    setError(null);
    if (!state.name.trim()) {
      setError("Name is required.");
      return;
    }
    let predicate: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(state.predicate);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setError("Predicate must be a JSON object.");
        return;
      }
      predicate = parsed as Record<string, unknown>;
    } catch {
      setError("Predicate is not valid JSON.");
      return;
    }
    onSubmit({
      name: state.name.trim(),
      description: state.description.trim() || null,
      severity: state.severity,
      enabled: state.enabled,
      predicate,
    });
  };

  return (
    <form className="flex flex-col gap-3" onSubmit={handleSubmit} data-testid="alert-rule-form">
      <Field label="Name" htmlFor="rule-name">
        <Input
          id="rule-name"
          value={state.name}
          onChange={(e) => setState({ ...state, name: e.target.value })}
          placeholder="e.g. Free-WiFi rogue SSID"
        />
      </Field>
      <Field label="Description" htmlFor="rule-description">
        <Input
          id="rule-description"
          value={state.description}
          onChange={(e) => setState({ ...state, description: e.target.value })}
          placeholder="What does this rule catch?"
        />
      </Field>
      <Field label="Severity" htmlFor="rule-severity">
        <select
          id="rule-severity"
          value={state.severity}
          onChange={(e) => setState({ ...state, severity: e.target.value as AlertSeverity })}
          className="h-9 rounded-sm border border-fg-20 bg-bg-1 px-3 text-sm"
        >
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Enabled" htmlFor="rule-enabled">
        <input
          id="rule-enabled"
          type="checkbox"
          checked={state.enabled}
          onChange={(e) => setState({ ...state, enabled: e.target.checked })}
          className="size-4 accent-mode"
        />
      </Field>
      <Field label="Predicate (JSON)" htmlFor="rule-predicate">
        <textarea
          id="rule-predicate"
          rows={8}
          value={state.predicate}
          onChange={(e) => setState({ ...state, predicate: e.target.value })}
          className="w-full rounded-sm border border-fg-20 bg-bg-inset p-2 font-mono text-2xs text-fg-100"
          spellCheck={false}
        />
      </Field>
      {error && (
        <p role="alert" className="text-2xs text-accent-red">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1.5">
      <span className="text-2xs uppercase tracking-wide text-fg-60">{label}</span>
      {children}
    </label>
  );
}
