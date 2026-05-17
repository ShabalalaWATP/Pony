import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Deep-link helper: `/sensors/<id>` redirects to the list view with the
 * drawer pre-opened via `?id=<id>`. Keeps the canonical operator URL
 * shape as a single route with a search param.
 */
export const Route = createFileRoute("/_shell/sensors/$sensorId")({
  beforeLoad: ({ params }) => {
    // TanStack Router uses `throw redirect(...)` as its control-flow
    // mechanism; the thrown value is a sentinel object, not an Error.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({
      to: "/sensors",
      search: { id: params.sensorId },
    });
  },
});
