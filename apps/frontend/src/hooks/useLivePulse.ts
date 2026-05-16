import { useEffect, useState } from "react";

/**
 * Returns true while `lastEventAt` is within `freshWindowMs` of "now".
 * Re-evaluates on a slow interval so a stale signal eventually flips to false
 * even without external state changes.
 */
export function useLivePulse(
  lastEventAt: Date | number | null | undefined,
  freshWindowMs = 5_000,
): boolean {
  const [fresh, setFresh] = useState<boolean>(false);

  useEffect(() => {
    if (lastEventAt == null) {
      setFresh(false);
      return;
    }
    const tsMs = typeof lastEventAt === "number" ? lastEventAt : lastEventAt.getTime();

    const evaluate = (): void => {
      setFresh(Date.now() - tsMs < freshWindowMs);
    };
    evaluate();
    const interval = window.setInterval(evaluate, 1_000);
    return () => window.clearInterval(interval);
  }, [lastEventAt, freshWindowMs]);

  return fresh;
}
