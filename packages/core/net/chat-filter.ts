// Chat and display-name filter, shared by the client (instant feedback) and the Room (the authority).
// Friend rooms only, adults only (game-design 3.7, tech.md 2.11): 200 characters, one message per 5 s, and no
// profanity, links, e-mail addresses, phone numbers or @handles. Strangers and under-18 players never reach this:
// they can send preset messages and reactions only. A blocked message is not delivered; the sender is told why.
//
// The word lists are deliberately conservative about short words: every entry was checked against common words in
// English, Turkish, German, Spanish and French (the tests carry the false-positive corpus).
import type { ChatRejectReason } from '../types/net.ts';

export const CHAT_MAX_CHARS = 200;
export const CHAT_INTERVAL_MS = 5000;
export const NAME_MAX_CHARS = 20;

export type FilterReason = Extract<ChatRejectReason, 'empty' | 'too_long' | 'link' | 'email' | 'phone' | 'handle' | 'profanity'>;
export type FilterResult = { ok: true; text: string } | { ok: false; reason: FilterReason };

// ───────── word lists ─────────
// Plain entries match a whole word; `x*` matches words that start with x; `~x` matches anywhere inside a word.
// Entries written in plain ASCII are matched against the accent-free, look-alike-folded form of each word (so
// "f0ck" and "orospú" are caught). Entries with accented letters match only the accented form, because their ASCII
// spelling is an ordinary word elsewhere (göt/got, piç/pic, amına/amina).
const WORDS: readonly string[] = [
  // English
  '~fuck', '~shit', 'cunt', 'cunts', '~nigger', '~nigga', '~faggot', 'fag', 'fags', '~whore', '~bitch', '~asshole',
  '~dickhead', '~cocksuck', '~blowjob', '~handjob', '~dildo', '~jizz', '~porn', '~retard', 'pussy', 'pussies',
  'ass', 'arse', 'dick', 'dicks', 'cock', 'cocks', 'cum', 'slut', 'sluts', 'slutty', 'twat', 'wank', 'wanker',
  'tits', 'boobs', 'nude', 'nudes', 'sex', 'sexting', 'horny', 'rape', 'raped', 'rapist', 'penis', 'vagina',
  'bastard', 'bollocks', 'prick', 'bellend', 'spic', 'chink', 'kike', 'tranny', 'kys',
  // Turkish
  'amk', 'aq', 'amq', 'amına', 'amcık', 'amcik', '~orospu', 'oç', 'piç', 'piçler', 'sik', 'siktir', 'siktirgit',
  'sikerim', 'sikeyim', 'sikik', 'sikis', 'sikim', 'siktim', 'sikiyim', 'sikicem', 'sikecem', '~yarrak', 'yarak',
  'taşak', 'tasak', 'göt', 'götveren', 'gotveren', 'ibne', 'ibneler', '~pezevenk', '~kahpe', 'kaltak', 'sürtük',
  'surtuk', 'gavat', 'şerefsiz', 'serefsiz', 'yavşak', 'yavsak', 'puşt', 'fahişe', 'fahise', 'kevaşe', 'kevase',
  'seks', 'dalyarak',
  // German
  '~scheiss', 'scheiße', '~fotze', '~hurenso', '~wichser', '~arschl', '~schlampe', 'fick', 'ficken', 'fickt',
  'missgeburt', 'spast',
  // Spanish
  'puta', 'putas', 'puto', 'putos', '~mierda', 'coño', '~gilipollas', 'cabrón', 'cabron', '~pendejo', 'maricón',
  'maricon', 'joder', 'verga', 'chinga*',
  // French
  '~putain', 'merde', 'merdique', '~salope', '~connard', '~connasse', 'enculé', 'encul*', 'pute', 'putes', 'pédé',
  'niquer', 'nique',
];

/** Phrases matched on the folded text with word boundaries. */
const PHRASES: readonly string[] = ['kill yourself', 'kill urself', 'go die', 'suck my', 'ta gueule', 'son of a b'];

// ───────── normalisation ─────────
// Invisible and direction-changing characters are removed before anything else, so they cannot split a word.
const INVISIBLE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/g;

/** Cyrillic and Greek letters that look like Latin ones. */
const LOOKALIKE: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', к: 'k', м: 'm', т: 't', н: 'h', в: 'b', і: 'i', ј: 'j',
  ѕ: 's', ԁ: 'd', ɡ: 'g', α: 'a', ο: 'o', ν: 'v', ρ: 'p', τ: 't', ι: 'i', κ: 'k', υ: 'u', ε: 'e', ı: 'i',
};
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '|': 'i' };

/** Strips invisible characters, applies NFKC (full-width and stylised letters become plain) and collapses spaces. */
export function sanitize(raw: string): string {
  return raw.replace(INVISIBLE, '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/** Lowercase with accents kept (two lowercasings: Turkish dotted/dotless I and the default). */
function lowerForms(s: string): string[] {
  const a = s.toLowerCase();
  const b = s.toLocaleLowerCase('tr');
  return a === b ? [a] : [a, b];
}

/** Accent-free, look-alike-folded lowercase. */
function fold(s: string): string {
  let out = '';
  for (const ch of s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')) out += LOOKALIKE[ch] ?? ch;
  return out;
}

const collapse3 = (w: string): string => w.replace(/(.)\1{2,}/g, '$1');
const collapseAll = (w: string): string => w.replace(/(.)\1+/g, '$1');

interface Entry { word: string; kind: 'word' | 'prefix' | 'inside'; ascii: boolean }
const ENTRIES: Entry[] = WORDS.map((w) => {
  const kind = w.startsWith('~') ? 'inside' : w.endsWith('*') ? 'prefix' : 'word';
  const word = w.replace(/^~|\*$/g, '');
  return { word, kind, ascii: /^[a-z]+$/.test(word) };
});

function entryHits(e: Entry, candidates: readonly string[]): boolean {
  for (const c of candidates) {
    if (e.kind === 'word' && c === e.word) return true;
    if (e.kind === 'prefix' && c.startsWith(e.word)) return true;
    if (e.kind === 'inside' && c.includes(e.word)) return true;
  }
  // Stretched spellings ("fuuuck", "shiiit"): compare with doubled letters collapsed, only for entries long enough
  // that the collapsed form cannot be an ordinary short word ("ass" collapses to "as").
  const ce = collapseAll(e.word);
  if (ce.length >= 4) {
    for (const c of candidates) {
      const cc = collapseAll(c);
      if (e.kind === 'word' && cc === ce) return true;
      if (e.kind === 'prefix' && cc.startsWith(ce)) return true;
      if (e.kind === 'inside' && cc.includes(ce)) return true;
    }
  }
  return false;
}

/** Words of a text: letters (any script) and digits; words made only of single letters are also joined ("f u c k"). */
function words(s: string): string[] {
  const parts = s.split(/[^\p{L}\p{N}@$!|]+/u).filter(Boolean);
  const out = parts.slice();
  let run = '';
  for (const p of parts) {
    if ([...p].length === 1) run += p;
    else { if (run.length >= 3) out.push(run); run = ''; }
  }
  if (run.length >= 3) out.push(run);
  return out;
}

function leet(w: string): string {
  if (!/\p{L}/u.test(w)) return w;          // a plain number stays a number
  let out = '';
  for (const ch of w) out += LEET[ch] ?? ch;
  return out;
}

export function hasProfanity(text: string): boolean {
  const accented = new Set<string>();
  const ascii = new Set<string>();
  for (const lower of lowerForms(text)) {
    for (const w of words(lower)) {
      const plain = w.replace(/[@$!|]/g, '');
      if (plain) { accented.add(plain); accented.add(collapse3(plain)); }
      const f = fold(leet(w)).replace(/[^a-z]/g, '');
      if (f) { ascii.add(f); ascii.add(collapse3(f)); }
    }
  }
  const acc = [...accented], asc = [...ascii];
  for (const e of ENTRIES) if (entryHits(e, e.ascii ? asc : acc)) return true;
  const flat = ' ' + fold(leet(text.toLowerCase())).replace(/[^a-z]+/g, ' ').trim() + ' ';
  return PHRASES.some((p) => flat.includes(' ' + p + ' ') || flat.includes(' ' + p));
}

// ───────── contact details ─────────
const TLDS = 'com|net|org|io|co|me|tv|gg|app|dev|xyz|info|biz|ru|tr|de|uk|fr|es|it|nl|us|ly|link|live|site|online|club|top|shop|store|tk|ml|ga|cf|gq|to|cc|ws|be|ch|at|pl|br|in|jp|cn|ai|so|fm|am|gl|eu|ca|au|mx|ar|cl|pt|se|no|fi|dk|gr|ro|hu|cz|ua|kz|az|ir|sa|ae|il|edu|gov|page|chat|fun|vip|lol|wtf|sex|porn|xxx|onion';
const URL_RE = new RegExp(String.raw`(https?:\/\/|www\s*\.|\b[\p{L}\p{N}-]{2,}\s*(\.|\(dot\)|\[dot\]|\bdot\b|\bnokta\b)\s*(${TLDS})\b|\b(t\.me|wa\.me|bit\.ly|discord\.gg)\b)`, 'iu');
const EMAIL_RE = /[\p{L}\p{N}._%+-]+\s*(@|\(at\)|\[at\]|\bat\b)\s*[\p{L}\p{N}-]+\s*(\.|\(dot\)|\[dot\]|\bdot\b|\bnokta\b)\s*[a-z]{2,}/iu;
const MAIL_WORDS = /\b(gmail|hotmail|outlook|yahoo|icloud|yandex|protonmail|proton\.me)\b/i;
const HANDLE_RE = /(^|[^\p{L}\p{N}._%+-])@[\p{L}\p{N}_.]{3,}/u;
const SOCIAL_RE = /\b(instagram\.com|tiktok\.com|snapchat\.com|facebook\.com|fb\.com|twitter\.com|x\.com|discord\.com|telegram\.me|onlyfans|whatsapp\.com)\b/i;

/** Seven or more digits in one run, allowing spaces, dots, dashes, slashes and brackets between them. */
function hasPhone(text: string): boolean {
  const m = text.match(/\+?[\d٠-٩۰-۹][\d٠-٩۰-۹\s().\-/]{5,}[\d٠-٩۰-۹]/gu);
  if (!m) return false;
  return m.some((run) => (run.match(/[\d٠-٩۰-۹]/gu) ?? []).length >= 7);
}

function contactReason(text: string): FilterReason | null {
  if (EMAIL_RE.test(text) || MAIL_WORDS.test(text)) return 'email';
  if (URL_RE.test(text) || SOCIAL_RE.test(text)) return 'link';
  if (HANDLE_RE.test(text)) return 'handle';
  if (hasPhone(text)) return 'phone';
  return null;
}

/** Checks one chat message. Returns the cleaned text to send, or why it was blocked. */
export function checkChat(raw: string): FilterResult {
  const text = sanitize(String(raw ?? ''));
  if (!text) return { ok: false, reason: 'empty' };
  if ([...text].length > CHAT_MAX_CHARS) return { ok: false, reason: 'too_long' };
  const contact = contactReason(text);
  if (contact) return { ok: false, reason: contact };
  if (hasProfanity(text)) return { ok: false, reason: 'profanity' };
  return { ok: true, text };
}

/** Checks a display name: 1-20 characters of letters, digits, spaces and . _ - only, same word and contact rules. */
export function checkName(raw: string): FilterResult {
  const text = sanitize(String(raw ?? ''));
  if (!text) return { ok: false, reason: 'empty' };
  if ([...text].length > NAME_MAX_CHARS) return { ok: false, reason: 'too_long' };
  if (!/^[\p{L}\p{N} ._-]+$/u.test(text)) return { ok: false, reason: 'handle' };
  if (hasPhone(text)) return { ok: false, reason: 'phone' };
  if (URL_RE.test(text) || SOCIAL_RE.test(text)) return { ok: false, reason: 'link' };
  if (hasProfanity(text)) return { ok: false, reason: 'profanity' };
  return { ok: true, text };
}
