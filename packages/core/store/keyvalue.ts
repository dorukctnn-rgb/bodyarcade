// A store namespace as the plain text key-value shape that live play's books use (core/net: the ghost book and the identity take
// `{ get(key): string | null, set(key, text): void }`, and on their own they keep one device-wide key in localStorage). Handed one
// of these on a profile's namespace, a book keeps its recordings in that profile's own record: the family races each other's
// bests, a kid's profile has a book of its own and never sees the recordings of friends, and deleting a profile deletes its book.
//
// It never throws: a key the store does not accept, a store that is read-only (a look at somebody else's record, a locked profile)
// or a value that is not text leave things as they were, and what is not there is null.
import type { Schema } from '../types/index.ts';
import type { StoreNamespace } from './store.ts';

export interface KeyValue {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const TEXT: Schema<string> = { version: 1, parse: (raw) => (typeof raw === 'string' ? raw : null) };

export function keyValueOf(ns: StoreNamespace): KeyValue {
  return {
    get(key) {
      try {
        const v = ns.get(key, TEXT, '');
        return v === '' ? null : v;
      } catch { return null; }
    },
    set(key, value) {
      try { if (typeof value === 'string') ns.set(key, value, TEXT); } catch { /* not a key this store takes */ }
    },
  };
}
