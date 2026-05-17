import { createFileRoute } from "@tanstack/react-router";
import { Overview } from "@/views/Overview";

export const Route = createFileRoute("/_shell/")({
  component: Overview,
});
