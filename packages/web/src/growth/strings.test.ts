// The progress coach's words: five languages with the same keys and no empty text; none of the words we never use
// (the banned food words of SPEC 4.2, medical claims, the "artificial intelligence" words in any language), in the
// strings and in every growth source file; and the safety sentences exist in every language.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BANNED_WORDS } from '../../../core/growth/nutrition/guards.ts';
import { MEALS } from '../../../core/growth/nutrition/meals.ts';
import { GROWTH_WORDS, SUPPORT } from './strings.ts';

const LANGS = Object.keys(GROWTH_WORDS) as (keyof typeof GROWTH_WORDS)[];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.(ts|mjs|html|json)$/.test(f) ? [p] : []; });
}

describe('progress coach words', () => {
  it('has the five site languages, the same keys, no empty text', () => {
    expect([...LANGS].sort()).toEqual(['de', 'en', 'es', 'fr', 'tr']);
    const keys = Object.keys(GROWTH_WORDS.en).sort();
    for (const l of LANGS) {
      expect(Object.keys(GROWTH_WORDS[l]).sort(), l).toEqual(keys);
      for (const [k, t] of Object.entries(GROWTH_WORDS[l])) expect(t.trim().length, `${l} ${k}`).toBeGreaterThan(0);
    }
  });

  it('Turkish is complete: no sentence is left in English', () => {
    const en = GROWTH_WORDS.en, tr = GROWTH_WORDS.tr;
    const same = Object.keys(en).filter((k) => en[k as keyof typeof en] === tr[k as keyof typeof tr] && /[a-z]{4,} [a-z]{3,}/i.test(en[k as keyof typeof en]));
    // the USDA credit stays in English on purpose (the source's own name)
    expect(same.filter((k) => k !== 'fdc')).toEqual([]);
  });

  it('the safety sentences are translated in every language (not English fall-backs)', () => {
    const safety = ['foodFooter', 'gate_pregnant', 'gate_condition', 'gate_minor', 'note_see-professional', 'avoidNote', 'painNote', 'ratiosNote', 'gate_underweight'] as const;
    for (const l of LANGS) if (l !== 'en') for (const k of safety) expect(GROWTH_WORDS[l][k], `${l} ${k}`).not.toBe(GROWTH_WORDS.en[k]);
  });

  it('no banned word, no medical claim in any language', () => {
    const all = Object.values(BANNED_WORDS).flat().map((w) => w.toLowerCase());
    for (const l of LANGS) for (const [k, t] of Object.entries(GROWTH_WORDS[l])) {
      const low = t.toLowerCase();
      // "treat" appears inside "treatment" in the sentence that says it is NOT a treatment: only that key may carry it
      for (const w of all) if (low.includes(w) && !(k === 'avoidNote' && /treat|tedavi|behandlung|tratamiento|traitement/.test(w))) expect.fail(`${l}.${k} has "${w}"`);
    }
    for (const m of MEALS) for (const n of Object.values(m.name)) for (const w of all) expect(n.toLowerCase().includes(w), `${m.id}: ${w}`).toBe(false);
  });

  it('no "artificial intelligence" word anywhere in the growth code, strings or assets', () => {
    const roots = [fileURLToPath(new URL('.', import.meta.url)), fileURLToPath(new URL('../../../core/growth', import.meta.url)), fileURLToPath(new URL('../../../../tools/growth-twin', import.meta.url)), fileURLToPath(new URL('../../../../tools/food-data', import.meta.url))];
    const bad = /\bA\.?I\.?\b|\bKI\b|\bIA\b|yapay zek|artificial intelligence|künstliche intelligenz|inteligencia artificial|intelligence artificielle/;
    for (const r of roots) for (const f of files(r)) {
      // this file names the words it looks for
      if (f.endsWith('.bin') || f.endsWith('strings.test.ts')) continue;
      const text = readFileSync(f, 'utf8');
      expect(bad.test(text), f).toBe(false);
    }
  });

  it('support links exist for every language and are https', () => {
    for (const l of LANGS) { expect(SUPPORT[l].length, l).toBeGreaterThan(0); for (const s of SUPPORT[l]) expect(s.url).toMatch(/^https:\/\//); }
  });
});
