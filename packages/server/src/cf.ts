// The few Cloudflare Workers runtime types the server code needs, declared here so the strict program type-checks
// without @cloudflare/workers-types (which would clash with the DOM lib the rest of the tree uses). Types only:
// runtime globals (WebSocketPair, WebSocketRequestResponsePair) are read through `workersRuntime()`, never declared
// globally, so other modules can keep their own declarations without conflicts.

/** A binding that answers fetch: ASSETS, a Durable Object stub, a service binding. */
export interface Fetcher {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}

export interface DurableObjectIdLike {
  toString(): string;
  readonly name?: string;
}

export interface DurableObjectNamespaceLike {
  idFromName(name: string): DurableObjectIdLike;
  get(id: DurableObjectIdLike): Fetcher;
}

/** The server side of a WebSocket accepted by a Durable Object (Hibernation API). */
export interface CfWebSocket {
  readonly readyState: number;
  /** Only for a socket this Worker serves itself (not a Durable Object's hibernating sockets). */
  accept?(): void;
  send(message: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

export interface DurableObjectStorageLike {
  get<T = unknown>(key: string): Promise<T | undefined>;
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(keys: string[]): Promise<number>;
  deleteAll(): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

export interface DurableObjectStateLike {
  readonly id: DurableObjectIdLike;
  readonly storage: DurableObjectStorageLike;
  acceptWebSocket(ws: CfWebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): CfWebSocket[];
  setWebSocketAutoResponse(pair?: unknown): void;
  waitUntil(promise: Promise<unknown>): void;
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
}

interface WorkersRuntime {
  WebSocketPair: new () => { 0: CfWebSocket; 1: CfWebSocket };
  WebSocketRequestResponsePair: new (request: string, response: string) => unknown;
}

/** Runtime-only globals of workerd. Throws a clear error when called outside the Workers runtime. */
export function workersRuntime(): WorkersRuntime {
  const g = globalThis as unknown as Partial<WorkersRuntime>;
  if (!g.WebSocketPair || !g.WebSocketRequestResponsePair) throw new Error('not running in the Workers runtime');
  return g as WorkersRuntime;
}

/** `new Response(null, { status: 101, webSocket })`: the `webSocket` field is Workers-only. */
export function upgradeResponse(client: CfWebSocket, headers?: HeadersInit): Response {
  return new Response(null, { status: 101, webSocket: client, headers } as ResponseInit);
}
