import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { type OperatorMessage } from "./operator";
import { useLiveTopic } from "./hooks";

/** Topic → root query key map. */
const TOPIC_TO_KEY: Record<string, readonly unknown[]> = {
  "aps.upsert": ["access_points"],
  "devices.upsert": ["devices"],
  "sensors.update": ["sensors"],
};

/**
 * Mount once in the app shell. Listens for the M2.1 operator-WS topics
 * (`aps.upsert`, `devices.upsert`, `sensors.update`) and invalidates the
 * matching TanStack Query caches so list views refetch in the
 * background without a full page reload.
 *
 * Bursty backends emit many upserts per second — we coalesce to one
 * invalidation per query-root per ~250ms window per topic so we don't
 * thrash the network or the table.
 */
export function useOperatorCacheInvalidations(): void {
  const qc = useQueryClient();
  const pendingRef = useRef<Map<string, number>>(new Map());

  const handler = useMemo(
    () =>
      (msg: OperatorMessage): void => {
        const rootKey = TOPIC_TO_KEY[msg.kind];
        if (!rootKey) return;
        const cacheKey = String(rootKey[0]);
        if (pendingRef.current.has(cacheKey)) return;
        const timer = window.setTimeout(() => {
          pendingRef.current.delete(cacheKey);
          void qc.invalidateQueries({ queryKey: rootKey });
        }, 250);
        pendingRef.current.set(cacheKey, timer);
      },
    [qc],
  );

  const match = useMemo(
    () =>
      (msg: OperatorMessage): boolean =>
        msg.kind in TOPIC_TO_KEY,
    [],
  );

  useLiveTopic(match, handler);

  // Clean up pending coalesce timers on unmount so dangling timeouts
  // don't fire after the shell unmounts during a logout.
  useEffect(() => {
    const pending = pendingRef.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);
}
