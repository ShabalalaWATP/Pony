/**
 * No-op WebSocket replacement for unit tests.
 *
 * `OperatorWebSocketClient` blindly does `new WebSocket(url)` on mount,
 * which under msw v2 surfaces as
 * "intercepted a WebSocket connection without a matching event handler".
 * We don't want each unit test to wire up an msw WS handler just to
 * silence that, so this stub:
 *
 *  - swallows construction and never emits an `error`,
 *  - returns `CONNECTING` state forever (so the rest of the connection
 *    state machine sits at `connecting` for the whole test),
 *  - records `addEventListener` / `send` calls so consumers can poke
 *    at them if they want, but does NOT auto-fire anything,
 *  - is a drop-in replacement at the prototype level (matches
 *    `WebSocket` static constants used by `OperatorWebSocketClient`).
 *
 * Tests that need a controllable socket override this default per-suite
 * via `vi.stubGlobal("WebSocket", FakeSocket)`.
 */
export class SilentWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = SilentWebSocket.CONNECTING;
  readonly OPEN = SilentWebSocket.OPEN;
  readonly CLOSING = SilentWebSocket.CLOSING;
  readonly CLOSED = SilentWebSocket.CLOSED;

  readonly url: string;
  readyState: number = SilentWebSocket.CONNECTING;
  binaryType: BinaryType = "blob";
  bufferedAmount = 0;
  extensions = "";
  protocol = "";

  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null;
  onerror: ((this: WebSocket, ev: Event) => unknown) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null;
  onopen: ((this: WebSocket, ev: Event) => unknown) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(): void {
    /* noop */
  }
  removeEventListener(): void {
    /* noop */
  }
  dispatchEvent(): boolean {
    return false;
  }
  send(): void {
    /* noop */
  }
  close(): void {
    this.readyState = SilentWebSocket.CLOSED;
  }
}
