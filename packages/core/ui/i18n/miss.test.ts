// Every reason code the movement library can give has a sentence in English and Turkish: this walks the library's own
// list (MISS_CODES), so a code added there fails here until the strings exist.
import { describe, expect, it } from 'vitest';
import { MISS_CODES } from '../../moves/kit.ts';
import { copyProblems } from '../../../web/catalogue/copy.ts';
import { stringTables } from './index.ts';

describe('reason sentences', () => {
  it('there are reason codes to check', () => {
    expect(MISS_CODES.length).toBeGreaterThan(30);
  });

  for (const lang of ['en', 'tr'] as const) {
    it(`${lang}: every code has a short sentence that follows the copy rules`, () => {
      const t = stringTables[lang];
      for (const code of MISS_CODES) {
        const s = t[`miss.${code}`];
        expect(s, `${lang} miss.${code}`).toBeTruthy();
        // The strip during play holds at most 40 characters in English and 48 in translations (design/LAYOUT.md section 8).
        expect((s as string).length, `${lang} miss.${code}`).toBeLessThanOrEqual(lang === 'en' ? 40 : 48);
        expect(copyProblems(s as string), `${lang} miss.${code}`).toEqual([]);
      }
    });

    it(`${lang}: no sentence is left over for a code that no longer exists`, () => {
      const known = new Set<string>(MISS_CODES);
      for (const key of Object.keys(stringTables[lang]).filter((k) => k.startsWith('miss.'))) expect(known.has(key.slice(5)), key).toBe(true);
    });
  }
});
