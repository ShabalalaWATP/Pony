/**
 * API surface re-exports. The actual fetch client lands in Stage 2 — for
 * now we just expose the generated types so other code can begin to depend
 * on them.
 */
export type { paths, components, operations } from "./openapi";
