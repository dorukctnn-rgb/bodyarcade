// Test-only: the server's side of the synced documents, with the rules of packages/server/src/social/sync.ts (a write names the
// revision it was made from; a document may hold 3,000 characters), as the two calls the social client has. Not exported by
// index.ts and never bundled into the app.
import type { DocKey, SyncPort, SyncedDocument } from './sync-docs.ts';

/** The server's side of the documents, with the rules of src/social/sync.ts: a write names the revision it was made from. */
export class FakeSyncServer {
  readonly docs = new Map<string, SyncedDocument>();
  writes = 0;
  loads = 0;
  conflicts = 0;
  /** Called between a client's read and its write, once: another device writes then. */
  interfere: (() => void) | null = null;
  failLoad: unknown = null;
  failWrite: { key: string; error: unknown } | null = null;

  write(key: string, baseRev: number, data: unknown): { ok: true; rev: number } | { ok: false; current: SyncedDocument | null } {
    const cur = this.docs.get(key) ?? null;
    if ((cur?.rev ?? 0) !== baseRev) { this.conflicts++; return { ok: false, current: cur }; }
    if (JSON.stringify(data).length > 3000) throw Object.assign(new Error('payload_too_large'), { status: 413, code: 'payload_too_large' });
    this.writes++;
    this.docs.set(key, { rev: baseRev + 1, at: 1, data: JSON.parse(JSON.stringify(data)) as unknown });
    return { ok: true, rev: baseRev + 1 };
  }

  /** What a client's port is: the two calls the social client has, with its updateSync semantics (read, change, write, again on conflict). */
  port(): SyncPort {
    const server = this;
    return {
      async loadSync() {
        server.loads++;
        if (server.failLoad) throw server.failLoad;
        return Object.fromEntries([...server.docs].map(([k, d]) => [k, { ...d }]));
      },
      async updateSync<T>(key: DocKey, change: (c: T | null) => T, tries = 4) {
        if (server.failWrite?.key === key) throw server.failWrite.error;
        let cur: SyncedDocument | null = server.docs.get(key) ?? null;
        for (let attempt = 1; ; attempt++) {
          const data = change(cur ? (cur.data as T) : null);
          const hook = server.interfere;
          server.interfere = null;
          hook?.();
          const out = server.write(key, cur?.rev ?? 0, data);
          if (out.ok) return { rev: out.rev, at: 1, data };
          if (attempt >= tries) throw Object.assign(new Error('conflict'), { status: 409, code: 'conflict' });
          cur = out.current;
        }
      },
    };
  }
}
