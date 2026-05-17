import { createFileRoute } from "@tanstack/react-router";
import { MapView } from "@/components/map/MapView";

export const Route = createFileRoute("/_shell/map")({
  component: MapView,
});
