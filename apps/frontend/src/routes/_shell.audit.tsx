import { createFileRoute } from "@tanstack/react-router";
import { AuditView } from "@/components/audit/AuditView";

export const Route = createFileRoute("/_shell/audit")({
  component: AuditView,
});
