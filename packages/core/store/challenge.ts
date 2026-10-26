// Friend challenge links: the score rides in the URL and no server is involved (v1: site/game/store.js:161-178).
//
// Once a link is shared it is text from a stranger, so reading it keeps only a short plain name, a whole positive score
// and short ids, whatever the payload says (the 23 Oct 2026 audit found a string score going into innerHTML). Pure
// functions: the caller passes the page address and the query string, nothing here touches `location`.
//
// Links made by v1 (`<origin>/bodyarcade?c=<base64 of {n,s,w,d}>`) still read, and v1 can still read the links made here
// when they carry no game id, because the encoding is the same.

export interface Challenge {
  /** A short plain name; '' when the link carries none (the interface shows its own "a friend"). */
  name: string;
  score: number;
  /** World or biome id, '' when absent. */
  world: string;
  /** Difficulty id, '' when absent. */
  diff: string;
  /** Game id; '' for a v1 link, which could only mean the runner. */
  game: string;
}

export interface ChallengeInput {
  name?: string;
  score: number;
  world?: string;
  diff?: string;
  game?: string;
}

export const MAX_CHALLENGE_SCORE = 10_000_000;
export const CHALLENGE_NAME_MAX = 20;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,39}$/;
/** The longest `c=` value read at all (a real link is about 100 characters). */
const MAX_PARAM = 600;

function toBase64(o: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(o));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, '');
}

/** The JSON inside a link, or undefined for anything that is not base64 of UTF-8 JSON. Standard and URL-safe alphabets. */
function fromBase64(text: string): unknown {
  try {
    const std = text.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(std + '='.repeat((4 - (std.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

/** Control characters become spaces, runs of spaces collapse, the text is cut by whole characters (never inside an emoji). */
function cleanName(x: unknown): string {
  if (typeof x !== 'string' && typeof x !== 'number') return '';
  const s = String(x).replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, CHALLENGE_NAME_MAX).join('');
}

function cleanId(x: unknown): string {
  if (typeof x !== 'string' && typeof x !== 'number') return '';
  const s = String(x);
  return ID_RE.test(s) ? s : '';
}

/** A whole positive score up to ten million, from a number or a plain digit string; null otherwise. */
function cleanScore(x: unknown): number | null {
  const n = typeof x === 'number' ? x : typeof x === 'string' && /^\d{1,8}$/.test(x) ? Number(x) : NaN;
  return Number.isSafeInteger(n) && n > 0 && n <= MAX_CHALLENGE_SCORE ? n : null;
}

/**
 * The address to share. `base` is the page that opens the challenge, for example 'https://bodyarcade.com/bodyarcade'
 * (a fragment is dropped, an existing query string is kept). Null when the score cannot be a challenge: it must be a
 * whole number above zero.
 */
export function challengeLink(base: string, input: ChallengeInput): string | null {
  const score = cleanScore(typeof input.score === 'number' ? Math.floor(input.score) : NaN);
  if (score === null) return null;
  const payload: Record<string, unknown> = { s: score };
  const name = cleanName(input.name);
  if (name) payload['n'] = name;
  const world = cleanId(input.world); if (world) payload['w'] = world;
  const diff = cleanId(input.diff); if (diff) payload['d'] = diff;
  const game = cleanId(input.game); if (game) payload['g'] = game;
  const page = base.split('#')[0] ?? base;
  return `${page}${page.includes('?') ? '&' : '?'}c=${encodeURIComponent(toBase64(payload))}`;
}

/** The challenge in a query string (`location.search`), or null for none or for anything that does not check out. Never throws. */
export function readChallenge(search: string): Challenge | null {
  if (typeof search !== 'string') return null;
  const m = /[?&]c=([^&]+)/.exec(search);
  if (!m || (m[1] as string).length > MAX_PARAM) return null;
  let param: string;
  try { param = decodeURIComponent(m[1] as string); } catch { return null; }
  const d = fromBase64(param);
  if (typeof d !== 'object' || d === null || Array.isArray(d)) return null;
  const o = d as Record<string, unknown>;
  const score = cleanScore(o['s']);
  if (score === null) return null;
  return { name: cleanName(o['n']), score, world: cleanId(o['w']), diff: cleanId(o['d']), game: cleanId(o['g']) };
}
