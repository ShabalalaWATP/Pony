import { createFileRoute } from "@tanstack/react-router";
import { LabView } from "@/components/lab/LabView";

export const Route = createFileRoute("/_shell/lab/")({
  component: LabView,
});
