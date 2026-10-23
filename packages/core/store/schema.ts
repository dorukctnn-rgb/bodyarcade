// Small schema combinators for stored data. v1 read localStorage with `JSON.parse` and trusted the result (B4:
// `ba_runs = "oops"` froze the results screen). Every stored key now has a parser that either returns a clean value
// or says "invalid", and an invalid key resets to its fallback without touching any other key (rule 5 of 11.4).
//
// A parser never throws and never returns a value it did not check. Objects keep only the fields they declare, so
// foreign or hostile extra fields never persist, and `__proto__` can never become a key.
import type { Schema } from '../types/index.ts';
import { isDay } from './date.ts';

/** What a parser returns for a value that is not valid. */
export const BAD: unique symbol = Symbol('invalid');
export type Bad = typeof BAD;
export type Parser<T> = (raw: unknown) => T | Bad;
export type Infer<P> = P extends Parser<infer T> ? T : never;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const FORBIDDEN_KEYS = new Set(['__proto__']);

const fallbackValue = <T>(f: T | (() => T)): T => (typeof f === 'function' ? (f as () => T)() : structuredClone(f));

export const p = {
  string(o: { min?: number; max?: number; pattern?: RegExp; oneOf?: readonly string[] } = {}): Parser<string> {
    const { min = 0, max = 4000, pattern, oneOf } = o;
    return (raw) => {
      if (typeof raw !== 'string' || raw.length < min || raw.length > max) return BAD;
      if (pattern && !pattern.test(raw)) return BAD;
      if (oneOf && !oneOf.includes(raw)) return BAD;
      return raw;
    };
  },

  /** A finite number; `int` demands a whole number. NaN and Infinity are never valid. */
  number(o: { min?: number; max?: number; int?: boolean } = {}): Parser<number> {
    const { min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, int = false } = o;
    return (raw) => {
      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < min || raw > max) return BAD;
      if (int && !Number.isInteger(raw)) return BAD;
      return raw;
    };
  },

  boolean(): Parser<boolean> {
    return (raw) => (typeof raw === 'boolean' ? raw : BAD);
  },

  literal<T extends string | number | boolean>(v: T): Parser<T> {
    return (raw) => (raw === v ? v : BAD);
  },

  oneOf<T extends string>(values: readonly T[]): Parser<T> {
    return (raw) => (typeof raw === 'string' && (values as readonly string[]).includes(raw) ? (raw as T) : BAD);
  },

  /** 'YYYY-MM-DD', a real calendar date. */
  day(): Parser<string> {
    return (raw) => (isDay(raw) ? raw : BAD);
  },

  /** A whole number of epoch milliseconds between 1970 and the year 2100. */
  epoch(): Parser<number> {
    return p.number({ min: 0, max: 4_102_444_800_000, int: true });
  },

  /**
   * `lenient` drops invalid items and keeps the rest, so one damaged entry never costs the player their whole
   * history. Without it a single invalid item makes the whole array invalid. `max` keeps the first items.
   */
  array<T>(item: Parser<T>, o: { max?: number; lenient?: boolean } = {}): Parser<T[]> {
    const { max = 10_000, lenient = false } = o;
    return (raw) => {
      if (!Array.isArray(raw)) return BAD;
      const out: T[] = [];
      for (const x of raw) {
        const r = item(x);
        if (r === BAD) {
          if (lenient) continue;
          return BAD;
        }
        out.push(r);
        if (out.length >= max) break;
      }
      return out;
    };
  },

  record<T>(value: Parser<T>, o: { max?: number; key?: RegExp; lenient?: boolean } = {}): Parser<Record<string, T>> {
    const { max = 1000, key = /^[A-Za-z0-9_.:|-]{1,80}$/, lenient = false } = o;
    return (raw) => {
      if (!isRecord(raw)) return BAD;
      const out: Record<string, T> = {};
      let n = 0;
      for (const [k, v] of Object.entries(raw)) {
        const r = FORBIDDEN_KEYS.has(k) || !key.test(k) ? BAD : value(v);
        if (r === BAD) {
          if (lenient) continue;
          return BAD;
        }
        if (++n > max) {
          if (lenient) break;
          return BAD;
        }
        out[k] = r;
      }
      return out;
    };
  },

  /** Declared fields only. A field whose parser is optional() or withDefault() may be missing or damaged. */
  object<S extends Record<string, Parser<unknown>>>(shape: S): Parser<{ [K in keyof S]: Infer<S[K]> }> {
    const keys = Object.keys(shape);
    return (raw) => {
      if (!isRecord(raw)) return BAD;
      const out: Record<string, unknown> = {};
      for (const k of keys) {
        const parse = shape[k] as Parser<unknown>;
        const r = parse(Object.prototype.hasOwnProperty.call(raw, k) ? raw[k] : undefined);
        if (r === BAD) return BAD;
        if (r !== undefined) out[k] = r;
      }
      return out as { [K in keyof S]: Infer<S[K]> };
    };
  },

  /** Missing is fine; a present but invalid value is dropped. */
  optional<T>(item: Parser<T>): Parser<T | undefined> {
    return (raw) => {
      if (raw === undefined) return undefined;
      const r = item(raw);
      return r === BAD ? undefined : r;
    };
  },

  nullable<T>(item: Parser<T>): Parser<T | null> {
    return (raw) => (raw === null ? null : item(raw));
  },

  /** Missing or invalid becomes the default (a fresh copy every time). */
  withDefault<T>(item: Parser<T>, fallback: T | (() => T)): Parser<T> {
    return (raw) => {
      const r = item(raw);
      return r === BAD ? fallbackValue(fallback) : r;
    };
  },
};

/** Wraps a parser as the contract's Schema<T>: an invalid value becomes null, which resets the key to its fallback. */
export function schemaOf<T>(version: number, parser: Parser<T>, migrate?: (raw: unknown, from: number) => unknown): Schema<T> {
  const parse = (raw: unknown): T | null => {
    const r = parser(raw);
    return r === BAD ? null : r;
  };
  return migrate ? { version, parse, migrate } : { version, parse };
}
