import { useEffect, useMemo, useState } from "react";
import { type ConnectionState, OperatorWebSocketClient, type OperatorMessage } from "./operator";

let sharedClient: OperatorWebSocketClient | null = null;

function getSharedClient(): OperatorWebSocketClient {
  sharedClient ??= new OperatorWebSocketClient();
  return sharedClient;
}

/** Test-only — swap the module-level client with a fixture/mock. */
export function _setOperatorClientForTests(client: OperatorWebSocketClient | null): void {
  sharedClient = client;
}

/**
 * Subscribe to the shared operator WebSocket connection and reflect its
 * state into a React component.
 *
 * The first hook caller triggers `connect()`. Subsequent callers piggy-
 * back on the same socket. `disconnect()` is called when the hook
 * unmounts AND there are no remaining subscribers.
 */
export function useOperatorConnection(): { state: ConnectionState } {
  const client = useMemo(getSharedClient, []);
  const [state, setState] = useState<ConnectionState>(() => client.getState());

  useEffect(() => {
    client.connect();
    const unsubscribe = client.onStateChange(setState);
    return () => {
      unsubscribe();
    };
  }, [client]);

  return { state };
}

/**
 * Subscribe to messages whose `kind` matches the supplied predicate.
 * The handler ref is read fresh on each message so callers don't have to
 * memoise it.
 */
export function useLiveTopic(
  match: string | ((msg: OperatorMessage) => boolean),
  handler: (msg: OperatorMessage) => void,
): void {
  const client = useMemo(getSharedClient, []);
  useEffect(() => {
    const test = typeof match === "string" ? (m: OperatorMessage) => m.kind === match : match;
    const unsubscribe = client.subscribe((msg) => {
      if (test(msg)) handler(msg);
    });
    return () => {
      unsubscribe();
    };
  }, [client, match, handler]);
}
