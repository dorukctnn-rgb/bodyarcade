// The growth vault's keys (SPEC 2.10). Every record is sealed with AES-GCM 256 under one random data key, with a fresh
// 12-byte IV per record. The data key never rests unwrapped: without a PIN it is wrapped (AES-KW) by a non-extractable
// device key that lives in IndexedDB as a CryptoKey object (no script can read its bytes); with a PIN it is wrapped by a
// key derived from the PIN (PBKDF2-HMAC-SHA256, 600 000 iterations, OWASP Password Storage Cheat Sheet). A backup file
// carries the data key wrapped by a key derived from the backup password the same way.
// Codes only: errors are thrown as Error('vault:<code>').

/** OWASP Password Storage Cheat Sheet (2023+): PBKDF2-HMAC-SHA256 with 600 000 iterations. */
export const PBKDF2_ITERATIONS = 600_000;
export const IV_BYTES = 12;
export const SALT_BYTES = 16;

const subtle = (): SubtleCrypto => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('vault:no-crypto');
  return s;
};

export const randomBytes = (n: number): Uint8Array<ArrayBuffer> => globalThis.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));

/** A fresh data key. Extractable so it can be wrapped (for the device key, a PIN or a backup); it is never exported raw. */
export async function newDataKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** The device key that wraps the data key when there is no PIN. Not extractable: stored as the object itself. */
export async function newDeviceKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}

/** The wrapping key from a PIN or password and a salt. */
export async function deriveKey(secret: string, salt: Uint8Array<ArrayBuffer>, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', new TextEncoder().encode(secret.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}

export async function wrapDataKey(data: CryptoKey, by: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await subtle().wrapKey('raw', data, by, 'AES-KW'));
}

/** AES-KW checks integrity: a wrong PIN (a wrong wrapping key) fails here, never yields a wrong key. */
export async function unwrapDataKey(wrapped: Uint8Array<ArrayBuffer>, by: CryptoKey): Promise<CryptoKey> {
  try {
    return await subtle().unwrapKey('raw', wrapped, by, 'AES-KW', { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  } catch {
    throw new Error('vault:wrong-key');
  }
}

/** One sealed record: IV then ciphertext (with its 16-byte tag), in one byte array. */
export async function seal(key: CryptoKey, plain: Uint8Array<ArrayBuffer>, aad?: string): Promise<Uint8Array<ArrayBuffer>> {
  const iv = randomBytes(IV_BYTES);
  const params: AesGcmParams = { name: 'AES-GCM', iv, ...(aad ? { additionalData: new TextEncoder().encode(aad) } : {}) };
  const ct = new Uint8Array(await subtle().encrypt(params, key, plain));
  const out = new Uint8Array(new ArrayBuffer(IV_BYTES + ct.length));
  out.set(iv, 0); out.set(ct, IV_BYTES);
  return out;
}

export async function open(key: CryptoKey, sealed: Uint8Array<ArrayBuffer>, aad?: string): Promise<Uint8Array<ArrayBuffer>> {
  if (sealed.length < IV_BYTES + 16) throw new Error('vault:corrupt');
  const iv = sealed.slice(0, IV_BYTES);
  const ct = sealed.slice(IV_BYTES);
  const params: AesGcmParams = { name: 'AES-GCM', iv, ...(aad ? { additionalData: new TextEncoder().encode(aad) } : {}) };
  try {
    return new Uint8Array(await subtle().decrypt(params, key, ct));
  } catch {
    throw new Error('vault:corrupt');
  }
}

export const toB64 = (b: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromB64 = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** A PIN is 6 digits; a password at least 6 characters. Both are checked by the page and here. */
export const validSecret = (s: string): boolean => typeof s === 'string' && s.normalize('NFC').length >= 6 && s.length <= 128;
