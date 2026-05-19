import { createFileRoute } from "@tanstack/react-router";
import { AboutView } from "@/components/settings/AboutView";

export const Route = createFileRoute("/_shell/settings/about")({
  component: AboutView,
});
