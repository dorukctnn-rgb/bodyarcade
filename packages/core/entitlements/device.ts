// The device's own identifier: 16 random bytes in hex, made once and kept in the store. It names this browser to the
// entitlement server (seats per purchase) and is copied into every token issued for it, so a token that is copied to
// another device does not work there. It is not derived from anything about the person or the machine.
import { p, schemaOf, type StoreNamespace } from '../store/index.ts';
import { DID_RE } from './api.ts';

const DidSchema = schemaOf(1, p.string({ pattern: DID_RE, max: 32 }));

export type RandomBytes = (length: number) => Uint8Array;

const defaultRandom: RandomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

export function newDeviceId(random: RandomBytes = defaultRandom): string {
  return Array.from(random(16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The stored id, or a new one written now. A damaged value is replaced (the store has already reset the key). */
export function loadDeviceId(ns: StoreNamespace, random: RandomBytes = defaultRandom): string {
  const slot = ns.slot<string>('did', DidSchema, '');
  const have = slot.get();
  if (DID_RE.test(have)) return have;
  const id = newDeviceId(random);
  slot.set(id);
  return id;
}
