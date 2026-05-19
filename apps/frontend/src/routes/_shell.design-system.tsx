import { createFileRoute } from "@tanstack/react-router";
import { DesignSystem } from "@/views/DesignSystem";

export const Route = createFileRoute("/_shell/design-system")({
  component: DesignSystem,
});
