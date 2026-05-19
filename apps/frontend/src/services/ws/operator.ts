/**
 * Operator WebSocket client.
 *
 * Connects to `/ws/operator`, which the backend authenticates by reading
 * the `access_token` cookie (the same one the HTTP client uses). The
 * backend emits a `{"kind": "connected", ...}` payload on accept and is
 * expected to fan out topic-scoped messages thereafter (`devices.upsert`,
 * `events.append`, `alerts.fire`, …). Outbound text from us is treated
 * as a heartbeat by the server.
 *
 * The client auto-reconnects with exponential backoff capped at 30s.
 * Subscribers get every parsed message; topic-specific consumers filter
 * by `kind` in `useLiveTopic`.
 */

export interface OperatorMessage {
  kind: string;
  [key: string]: unknown;
}

type Listener = (msg: OperatorMessage) => void;
type StateListener = (state: ConnectionState) => void;

export type ConnectionState = "idle" | "connecting" | "open" | "closed";

const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

export class OperatorWebSocketClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private stateListeners = new Set<StateListener>();
  private state: ConnectionState = "idle";
  private backoff = MIN_BACKOFF_MS;
  private retryTimer: number | null = null;
  private stopped = false;

  constructor(private readonly url = "/ws/operator") {}

  connect(): void {
    if (this.stopped) this.stopped = false;
    if (this.socket && this.state !== "closed") return;
    this.setState("connecting");
    const absolute = this.toAbsolute(this.url);
    const socket = new WebSocket(absolute);
    this.socket = socket;
    socket.addEventListener("open", () => {
      this.backoff = MIN_BACKOFF_MS;
      this.setState("open");
    });
    socket.addEventListener("message", (event) => {
      const data = typeof event.data === "string" ? event.data : "";
      let parsed: OperatorMessage | null = null;
      try {
        const candidate = JSON.parse(data) as unknown;
        if (
          candidate &&
          typeof candidate === "object" &&
          "kind" in candidate &&
          typeof candidate.kind === "string"
        ) {
          parsed = candidate as OperatorMessage;
        }
      } catch {
        // Non-JSON or malformed payload — ignore (heartbeat echoes etc.)
      }
      if (!parsed) return;
      for (const listener of this.listeners) listener(parsed);
    });
    socket.addEventListener("close", () => {
      this.socket = null;
      this.setState("closed");
      if (!this.stopped) this.scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      // Browsers fire error THEN close — handled by close.
    });
  }

  disconnect(): void {
    this.stopped = true;
    if (this.retryTimer != null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.setState("idle");
  }

  send(text: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(text);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    // Replay current state on subscribe so the consumer doesn't miss it.
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  getState(): ConnectionState {
    return this.state;
  }

  private setState(next: ConnectionState): void {
    if (this.state === next) return;
    this.state = next;
    for (const listener of this.stateListeners) listener(next);
  }

  private scheduleReconnect(): void {
    if (this.retryTimer != null) return;
    const jitter = Math.floor(Math.random() * 250);
    const delay = Math.min(this.backoff + jitter, MAX_BACKOFF_MS);
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
      this.connect();
    }, delay);
  }

  private toAbsolute(relative: string): string {
    if (/^wss?:\/\//.test(relative)) return relative;
    if (typeof window === "undefined") return relative;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}${relative}`;
  }
}
