import { describe, expect, it } from 'vitest';
import { createStore, memoryStorage } from '../store/index.ts';
import { DID_RE } from './api.ts';
import { loadDeviceId, newDeviceId } from './device.ts';

describe('the device id', () => {
  it('is 32 lower-case hex characters from the random source it is given', () => {
    expect(newDeviceId(() => Uint8Array.from({ length: 16 }, (_, i) => i * 16 + i))).toBe('00112233445566778899aabbccddeeff');
    expect(newDeviceId()).toMatch(DID_RE);
    expect(newDeviceId()).not.toBe(newDeviceId());
  });

  it('asks for sixteen bytes and nothing else', () => {
    let asked = 0;
    newDeviceId((n) => { asked = n; return new Uint8Array(n); });
    expect(asked).toBe(16);
  });

  it('is made once and kept', () => {
    const storage = memoryStorage();
    const ns = createStore({ storage }).ns('entitlements');
    const first = loadDeviceId(ns);
    expect(first).toMatch(DID_RE);
    expect(loadDeviceId(ns)).toBe(first);
    expect(loadDeviceId(createStore({ storage }).ns('entitlements'))).toBe(first);
  });

  it('replaces a damaged value instead of using it', () => {
    for (const bad of ['"short"', '"' + 'G'.repeat(32) + '"', '5', 'null', '{"v":1,"d":{"x":1}}', '{broken']) {
      const storage = memoryStorage({ 'ba2.entitlements.did': bad });
      const id = loadDeviceId(createStore({ storage }).ns('entitlements'));
      expect(id, bad).toMatch(DID_RE);
      expect(loadDeviceId(createStore({ storage }).ns('entitlements')), bad).toBe(id);
    }
  });

  it('is the same on a storage that refuses writes, for the rest of the session', () => {
    const storage = { ...memoryStorage(), setItem: () => { throw new Error('quota'); } };
    const ns = createStore({ storage }).ns('entitlements');
    const id = loadDeviceId(ns);
    expect(id).toMatch(DID_RE);
    expect(loadDeviceId(ns)).toBe(id);
  });
});
