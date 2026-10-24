// The few platform pieces the live client touches, as interfaces, so the same client code runs in the browser, in the
// two-browser test suite and, with fakes for time and sockets, in plain Node unit tests.

/** Time and timers. now() is a monotonic wall clock in ms (performance.timeOrigin + performance.now()), not Date.now(). */
export interface Scheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realScheduler: Scheduler = {
  now: () => performance.timeOrigin + performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** The part of WebSocket the client uses. */
export interface SocketLike {
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type SocketFactory = (url: string) => SocketLike;

export const WS_CONNECTING = 0;
export const WS_OPEN = 1;

export const browserSocket: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike;

type Handler<T> = (detail: T) => void;

/** A small typed emitter: `on` returns the function that removes the listener. A throwing listener never stops the others. */
export class Emitter<E extends { [K in keyof E]: unknown }> {
  private readonly handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) { set = new Set(); this.handlers.set(type, set); }
    set.add(fn as Handler<never>);
    return () => { set?.delete(fn as Handler<never>); };
  }

  protected emit<K extends keyof E>(type: K, detail: E[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try { (fn as Handler<E[K]>)(detail); } catch (e) { console.error(`live listener for "${String(type)}" threw`, e); }
    }
  }
}

/** A random id for tabs and peer-connection epochs (URL-safe, 12 characters). */
export function randomId(random: () => number = Math.random): string {
  const A = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 12; i++) s += A[Math.floor(random() * A.length)];
  return s;
}
