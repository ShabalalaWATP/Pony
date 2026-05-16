import { DesignSystem } from "./routes/DesignSystem";

/**
 * Stage 1 shell — renders the design-system showcase directly so the visual
 * identity can be eyeballed before Stage 2 introduces the router and auth
 * gate.
 */
export function App(): JSX.Element {
  return <DesignSystem />;
}
