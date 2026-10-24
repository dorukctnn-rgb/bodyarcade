// The cues of the reason strip (cues.ts): one for every code the four games can give, in the five languages, in the house words, short
// enough for the narrowest strip; and the way a game says them: its own cue in the player's language, the shell's sentence for a code
// that has no cue, the game's English line when the shell has nothing.
import { describe, expect, it } from 'vitest';
import { MISS_CODES } from '../../core/moves/kit.ts';
import { createI18n, LANGS } from '../../core/ui/i18n/index.ts';
import { CUE_CODES, CUES, cueKey, cueText, withCues } from './cues.ts';
import { MISS_EN, reasonText } from './reasons.ts';
import { makeSay } from './text.ts';
import { stripProblems, tableCopyProblems, tableShapeProblems } from './testing/strings.ts';

describe('the cues', () => {
  it('there is one for every miss code the games have a fallback sentence for, and no more', () => {
    expect([...CUE_CODES].sort()).toEqual(Object.keys(MISS_EN).map((k) => k.replace(/^miss\./, '')).sort());
    for (const c of CUE_CODES) expect(MISS_CODES as readonly string[], `${c} is a code of the movement library`).toContain(c);
  });

  it('have the same codes in English, Turkish, German, Spanish and French', () => {
    expect(tableShapeProblems(CUES)).toEqual([]);
    for (const l of LANGS) expect(Object.keys(CUES[l]).sort(), l).toEqual(CUE_CODES.map(cueKey).sort());
  });

  it('follow the copy rules', () => {
    expect(tableCopyProblems(CUES)).toEqual([]);
  });

  it('fit the narrowest strip: two lines of ten letters, no word longer than a line', () => {
    const bad: string[] = [];
    for (const l of LANGS) for (const [k, v] of Object.entries(CUES[l])) for (const p of stripProblems(v)) bad.push(`${l} ${k} "${v}": ${p}`);
    expect(bad).toEqual([]);
  });

  it('are never longer than the shell\'s own sentence of the same code in English', () => {
    for (const c of CUE_CODES) expect((CUES.en[cueKey(c)] as string).length, c).toBeLessThanOrEqual((MISS_EN[`miss.${c}`] as string).length);
  });

  it('say something different for different codes (a cue that two codes share explains neither)', () => {
    for (const l of LANGS) {
      const seen = new Map<string, string>();
      for (const c of CUE_CODES) {
        const text = (CUES[l][cueKey(c)] as string).toLowerCase();
        expect(seen.get(text), `${l} "${text}" is the cue of ${seen.get(text)} and of ${c}`).toBeUndefined();
        seen.set(text, c);
      }
    }
  });
});

describe('a game says them', () => {
  it('through the shell\'s translator in the player\'s language, whatever the shell knows about the code', () => {
    for (const lang of LANGS) {
      const i18n = createI18n(lang);
      i18n.extend('game.test', withCues({ en: {}, tr: {}, de: {}, es: {}, fr: {} }));
      const say = makeSay({ t: (k, v) => i18n.scoped('game.test')(k, v) }, { ...MISS_EN, ...CUES.en });
      for (const c of CUE_CODES) expect(reasonText(say, c), `${lang} ${c}`).toBe(CUES[lang][cueKey(c)]);
    }
  });

  it('in the game\'s English lines when the shell has no words for it (a bare test context)', () => {
    const say = makeSay(null, { ...MISS_EN, ...CUES.en });
    expect(reasonText(say, 'feet_not_wide')).toBe('Feet wider');
    expect(reasonText(say, 'held_too_short')).toBe('Hold longer');
  });

  it('with the shell\'s sentence for a code that has no cue yet, so that a new code of a detector is still said', () => {
    const i18n = createI18n('tr');
    const say = makeSay({ t: (k, v) => i18n.scoped('game.test')(k, v) }, { ...MISS_EN, ...CUES.en });
    expect(cueText(say, 'foot_not_down')).toBe(i18n.t('miss.foot_not_down' as never));
    expect(cueText(say, 'foot_not_down')).toBe('Ayak yere geri inmedi');
  });

  it('a game\'s own line wins a clash with a cue', () => {
    const t = withCues({ en: { [cueKey('too_slow')]: 'Speed up' }, tr: {}, de: {}, es: {}, fr: {} });
    expect(t.en[cueKey('too_slow')]).toBe('Speed up');
    expect(t.tr[cueKey('too_slow')]).toBe('Çok yavaş');
  });
});
