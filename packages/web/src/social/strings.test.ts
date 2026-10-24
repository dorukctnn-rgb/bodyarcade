// The words of the friends screens (strings.ts): English and Turkish say the same things with the same variables, no text
// carries a dash, an arrow, a check mark, an emoji or an exclamation mark (the shell's copy rules), the Turkish uses its own
// letters, and the sentence of every failure code is there.
import { describe, expect, it } from 'vitest';
import { createI18n, variablesOf } from '../../../core/ui/i18n/index.ts';
import type { Failed, SocialFailure } from './port.ts';
import { failText, waitText } from './messages.ts';
import { en, tr, ux, type UxKey } from './strings.ts';

const keys = Object.keys(en) as UxKey[];

describe('the two languages', () => {
  it('have the same keys', () => {
    expect(Object.keys(tr).sort()).toEqual([...keys].sort());
  });

  it('use the same variables in every key', () => {
    for (const k of keys) expect(variablesOf(tr[k]), k).toEqual(variablesOf(en[k]));
  });

  it('fill every key with real text, with no braces left over and no placeholder', () => {
    for (const l of [en, tr]) {
      for (const k of keys) {
        const text = l[k];
        expect(text.trim().length, k).toBeGreaterThan(0);
        expect(text, k).not.toMatch(/TODO|FIXME|lorem|xxx/i);
        expect(text.replace(/\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, ''), k).not.toMatch(/[{}]/);
      }
    }
  });

  it('keep to the copy rules: no dashes as dashes, arrows, check marks, emoji or exclamation marks, no spaced hyphen', () => {
    const banned: [RegExp, string][] = [
      [/—/, 'em dash'], [/(?<=\D)–(?=\D)|\s–\s/, 'en dash'], [/[a-zçğıöşü,)] - [a-zA-ZÇĞİÖŞÜ(]/, 'spaced hyphen'], [/[→←↗↘⟶➜➔»]/, 'arrow'], [/[✓✔✅☑✗✘❌]/, 'check or cross'],
      [/\p{Extended_Pictographic}/u, 'emoji'], [/!/, 'exclamation mark'],
    ];
    for (const [name, table] of [['en', en], ['tr', tr]] as const) {
      for (const k of keys) for (const [re, what] of banned) expect(table[k], `${name} ${k}: ${what}`).not.toMatch(re);
    }
  });

  it('keep to the clichés list of the copy linter', () => {
    // The phrases are written in pieces so that the linter, which reads this file too, does not flag the list itself.
    const pieces = [['unlock'], ['seamless'], ['supercharge'], ['elevate'], ['revolutioniz'], ['game', 'changer'], ['next', 'level'], ['effortless'], ['cutting', 'edge'], ['leverage'], ['empower'], ['stunning'], ['magic'],
      ['peace', 'of', 'mind'], ['at', 'your', 'fingertips'], ['with', 'ease'], ['take', 'your'], ['boost', 'your']];
    const phrases = pieces.map((p) => p.join(' ')).concat(['game-changer', 'cutting-edge']);
    for (const k of keys) for (const p of phrases) expect(en[k].toLowerCase(), `${k}: ${p}`).not.toContain(p);
  });

  it('write Turkish with its own letters: long Turkish texts hold at least one of them', () => {
    for (const k of keys) {
      const text = tr[k].replace(/\{[^}]*\}/g, '');
      if (text.length > 60) expect(text, k).toMatch(/[çğıöşüÇĞİÖŞÜ]/);
    }
    // a few words that are easy to write without their letters
    const all = Object.values(tr).join(' ');
    for (const word of [/kapali/, /gonder/, /sifre/, /cikar/, /goruntu/, /kucuk/, /soyledin/, /degisti/, /baslar/, /kullanilamaz/, /hosgeldin/, /gunluk/]) expect(all).not.toMatch(word);
  });

  it('are never the same text in both languages unless it is a code or a number', () => {
    for (const k of keys) if (en[k] === tr[k]) expect(en[k].replace(/\{[^}]*\}/g, ''), k).toMatch(/^[^a-z]*$/i);
  });

  it('are all found through the shell\'s i18n, in English and in Turkish, without a missing word report', () => {
    for (const lang of ['en', 'tr'] as const) {
      const missing: string[] = [];
      const t = createI18n(lang, { onMissing: (k, l) => missing.push(`${l}:${k}`) });
      const u = ux({ i18n: t });
      for (const k of keys) {
        const vars = Object.fromEntries(variablesOf(en[k]).map((v) => [v, v === 'n' ? 2 : v === 'max' ? 100 : 'x']));
        const said = u(k, vars);
        expect(said, k).not.toBe(`ux.${k}`);
        if (variablesOf(en[k]).length === 0) expect(said, k).toBe((lang === 'en' ? en : tr)[k]);
      }
      expect(missing).toEqual([]);
    }
  });

  it('German, Spanish and French fall back to English (they are drafts), and never show a key', () => {
    for (const lang of ['de', 'es', 'fr'] as const) {
      const u = ux({ i18n: createI18n(lang) });
      expect(u('age.title')).toBe(en['age.title']);
    }
  });
});

describe('what a failure says', () => {
  const ctxOf = (lang: 'en' | 'tr') => ({ i18n: createI18n(lang) });
  const codes: SocialFailure[] = [
    'network', 'unavailable', 'rate_limited', 'too_many_attempts', 'bad_request', 'payload_too_large', 'unauthorized', 'clock_skew', 'replayed', 'unknown_device', 'forbidden', 'banned',
    'not_found', 'name_rejected', 'band_locked', 'already_friends', 'self', 'friends_full', 'requests_full', 'blocks_full', 'you_blocked', 'not_friends', 'child_no_public', 'child_no_online',
    'public_suspended', 'not_joinable', 'not_in_room', 'offline', 'conflict', 'closed', 'recovery_failed', 'unknown_game', 'bad_run', 'bad_score', 'run_expired', 'run_too_short', 'score_implausible',
  ];

  it('has a sentence for every code, in both languages, with nothing left of its variables', () => {
    for (const lang of ['en', 'tr'] as const) {
      const ctx = ctxOf(lang);
      for (const code of codes) {
        const f: Failed = { ok: false, code, retryAfterMs: 125_000, until: Date.UTC(2026, 10, 3, 14, 30), who: 'them' };
        const text = failText(ctx, f, { name: 'Ola' });
        expect(text.length, `${lang} ${code}`).toBeGreaterThan(8);
        expect(text, `${lang} ${code}`).not.toMatch(/ux\.|\{|\}|undefined|NaN/);
      }
    }
  });

  it('says how long to wait in the unit that reads best', () => {
    const en1 = ctxOf('en');
    expect(waitText(en1, undefined)).toBe('in a moment');
    expect(waitText(en1, 0)).toBe('in a moment');
    expect(waitText(en1, 400)).toBe('in 1 second');
    expect(waitText(en1, 40_000)).toBe('in 40 seconds');
    expect(waitText(en1, 125_000)).toBe('in 3 minutes');
    expect(waitText(en1, 55 * 60_000)).toBe('in 55 minutes');
    expect(waitText(en1, 5 * 3_600_000)).toBe('in 5 hours');
    expect(waitText(ctxOf('tr'), 125_000)).toBe('3 dakika sonra');
    expect(waitText(ctxOf('tr'), 40_000)).toBe('40 saniye sonra');
  });

  it('tells a refused name by what is wrong with it, and a mistyped code by which code', () => {
    const en1 = ctxOf('en');
    expect(failText(en1, { ok: false, code: 'name_rejected', reason: 'too_long' })).toBe(en['name.tooLong']);
    expect(failText(en1, { ok: false, code: 'name_rejected', reason: 'link' })).toBe(en['name.contact']);
    expect(failText(en1, { ok: false, code: 'name_rejected', reason: 'profanity' })).toBe(en['name.profanity']);
    expect(failText(en1, { ok: false, code: 'name_rejected' })).toBe(en['err.name_rejected']);
    expect(failText(en1, { ok: false, code: 'bad_request', field: 'code' })).toBe(en['recover.badCode']);
    expect(failText(en1, { ok: false, code: 'bad_request', field: 'recovery' })).toBe(en['recover.badRecovery']);
    expect(failText(en1, { ok: false, code: 'friends_full', who: 'them' }, { name: 'Ola' })).toContain('Ola');
    expect(failText(en1, { ok: false, code: 'friends_full', who: 'me' })).toBe(en['err.friends_full']);
    expect(failText(en1, { ok: false, code: 'not_found' }, { gone: true })).toBe(en['err.not_found_gone']);
    expect(failText(en1, { ok: false, code: 'banned' })).toBe(en['err.bannedNoDate']);
    expect(failText(en1, { ok: false, code: 'public_suspended' })).toBe(createI18n('en').t('lobby.suspended'));
  });
});
