// core/store: namespaced, schema-checked local storage with one date rule.

export interface Schema<T> {
  version: number;
  /** Returns null for anything that is not a valid T: the key resets to its fallback (B4). */
  parse(raw: unknown): T | null;
  migrate?(raw: unknown, from: number): unknown;
}

export interface Namespace {
  get<T>(key: string, s: Schema<T>, fallback: T): T;
  set<T>(key: string, v: T): void;
  remove(key: string): void;
}

export interface Store {
  /** Keys are per game; bests are per difficulty (B14). */
  ns(gameId: string): Namespace;
  /** The single local-date rule, 'YYYY-MM-DD' in the player's time zone (B13). */
  day(): string;
}
