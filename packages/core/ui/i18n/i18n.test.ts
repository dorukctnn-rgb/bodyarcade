import { describe, expect, it } from 'vitest';
import { createI18n, detectLang, LANGS, registerGameStrings, stringTables, variablesOf } from './index.ts';
import { formatMessage, parseMessage } from './icu.ts';

const env = (lang: string) => ({ lang, number: (n: number) => new Intl.NumberFormat(lang).format(n) });

describe('message formatter', () => {
  it('substitutes variables and numbers', () => {
    expect(formatMessage('Hello {name}, {n} left', { name: 'Ada', n: 1234 }, env('en'))).toBe('Hello Ada, 1,234 left');
    expect(formatMessage('{n} oyun', { n: 1234 }, env('tr'))).toBe('1.234 oyun');
  });

  it('handles plurals per language', () => {
    const msg = '{n, plural, =0 {No games} one {# game} other {# games}}';
    expect(formatMessage(msg, { n: 0 }, env('en'))).toBe('No games');
    expect(formatMessage(msg, { n: 1 }, env('en'))).toBe('1 game');
    expect(formatMessage(msg, { n: 12 }, env('en'))).toBe('12 games');
    const fr = '{n, plural, one {# jeu} many {# de jeux} other {# jeux}}';
    expect(formatMessage(fr, { n: 0 }, env('fr'))).toBe('0 jeu');
    expect(formatMessage(fr, { n: 2 }, env('fr'))).toBe('2 jeux');
  });

  it('handles select and nested variables', () => {
    const msg = '{who, select, p1 {Player 1 wins with {score}} p2 {Player 2 wins with {score}} other {Draw}}';
    expect(formatMessage(msg, { who: 'p2', score: 40 }, env('en'))).toBe('Player 2 wins with 40');
    expect(formatMessage(msg, { who: 'x', score: 1 }, env('en'))).toBe('Draw');
  });

  it('rejects broken messages and lists variables', () => {
    expect(() => formatMessage('{n, plural, one {x}}', { n: 1 }, env('en'))).toThrow(/other/);
    expect(() => parseMessage('oops }')).toThrow();
    expect(variablesOf('{n, plural, one {# of {total}} other {# of {total}}} {name}')).toEqual(['n', 'name', 'total']);
  });
});

describe('createI18n', () => {
  it('falls back to English and reports the missing key once', () => {
    const missing: string[] = [];
    const t = createI18n('de', { onMissing: (k, l) => missing.push(`${l}:${k}`) });
    expect(t.t('common.close')).toBe('Schließen');
    expect(t.t('common.pro')).toBe('Pro');
    t.t('common.pro');
    expect(missing).toEqual(['de:common.pro']);
  });

  it('returns the key for an unknown key instead of blank text', () => {
    const t = createI18n('en');
    expect(t.tx('no.such.key')).toBe('no.such.key');
    expect(t.has('no.such.key')).toBe(false);
  });

  it('extends with a game namespace and scopes lookups', () => {
    const t = createI18n('tr');
    t.extend('game.squat-flap', { en: { prompt: 'Squat' }, tr: { prompt: 'Çömel' } });
    const g = t.scoped('game.squat-flap');
    expect(g('prompt')).toBe('Çömel');
    expect(g('common.close')).toBe('Kapat');
  });

  it('registered game strings reach every I18n, also one made later for another language', () => {
    registerGameStrings('game.test-game', { en: { 'tg.prompt': 'Reach' }, tr: { 'tg.prompt': 'Uzan' } });
    const en = createI18n('en').scoped('game.test-game');
    const tr = createI18n('tr').scoped('game.test-game');
    expect(en('tg.prompt')).toBe('Reach');
    expect(tr('tg.prompt')).toBe('Uzan');
    // a language the game has no words for falls back to English, a key it does not have to the shell's own words
    expect(createI18n('de').scoped('game.test-game')('tg.prompt')).toBe('Reach');
    expect(tr('common.close')).toBe('Kapat');
    // an instance's own extend wins over the registry
    const own = createI18n('en');
    own.extend('game.test-game', { en: { 'tg.prompt': 'Own' } });
    expect(own.scoped('game.test-game')('tg.prompt')).toBe('Own');
  });

  it('formats numbers, money and lists for the language', () => {
    const tr = createI18n('tr');
    expect(tr.currency(7.99, 'USD')).toContain('7,99');
    expect(createI18n('en').list(['a', 'b', 'c'])).toBe('a, b, and c');
  });
});

describe('detectLang', () => {
  it('takes the first supported language by primary subtag', () => {
    expect(detectLang(['pt-BR', 'de-AT', 'en'])).toBe('de');
    expect(detectLang(['tr-TR'])).toBe('tr');
    expect(detectLang(['ja'])).toBe('en');
    expect(detectLang(undefined)).toBe('en');
  });
});

describe('string tables', () => {
  const en = stringTables.en;
  const keys = Object.keys(en);

  it('Turkish has every key', () => {
    expect(Object.keys(stringTables.tr).sort()).toEqual([...keys].sort());
  });

  for (const lang of LANGS) {
    it(`${lang}: only known keys, same variables as English, no reserved or banned characters`, () => {
      const table = stringTables[lang];
      for (const [k, v] of Object.entries(table)) {
        expect(en[k], `${lang} has unknown key ${k}`).toBeDefined();
        expect(variablesOf(v), `${lang}:${k} variables`).toEqual(variablesOf(en[k] as string));
        expect(v, `${lang}:${k}`).not.toMatch(/[—–→←✓✔✅]/u);
        expect(v, `${lang}:${k} has an empty string`).not.toBe('');
        expect(v, `${lang}:${k} has an exclamation mark`).not.toMatch(/!/);
      }
    });
  }
});
