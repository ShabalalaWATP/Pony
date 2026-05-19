import { createFileRoute } from "@tanstack/react-router";
import { UsersView } from "@/components/settings/UsersView";

export const Route = createFileRoute("/_shell/settings/users")({
  component: UsersView,
});
