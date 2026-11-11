// The form coach's words: every language has every sentence the coach can ask for, and none of the words we never use.
import { describe, expect, it } from 'vitest';
import { FORM_MOVES, FORM_MOVE_IDS } from '../../../core/form/moves/index.ts';
import { FORM_WORDS, fill } from './strings.ts';

const LANGS = Object.keys(FORM_WORDS) as (keyof typeof FORM_WORDS)[];

/** Every cue code a move can produce (a function cue is asked with values on both sides of its thresholds). */
function cueCodes(): Set<string> {
  const out = new Set<string>();
  for (const m of Object.values(FORM_MOVES)) {
    out.add(m.returnCue);
    for (const r of m.rules) {
      if (typeof r.cue === 'string') out.add(r.cue);
      else for (const v of [0, 60, 100, 150, 179, 181, 220, 999]) out.add(r.cue(v));
    }
  }
  return out;
}

describe('form coach words', () => {
  it('has the five site languages', () => {
    expect(LANGS.sort()).toEqual(['de', 'en', 'es', 'fr', 'tr']);
  });

  it('every language has the same keys as English, and no empty text', () => {
    const en = FORM_WORDS.en;
    for (const l of LANGS) {
      const w = FORM_WORDS[l];
      expect(Object.keys(w.ui).sort(), l).toEqual(Object.keys(en.ui).sort());
      expect(Object.keys(w.parts).sort(), l).toEqual(Object.keys(en.parts).sort());
      expect(Object.keys(w.cues).sort(), l).toEqual(Object.keys(en.cues).sort());
      expect(Object.keys(w.rules).sort(), l).toEqual(Object.keys(en.rules).sort());
      for (const id of FORM_MOVE_IDS) {
        expect(w.moves[id].name.length, `${l} ${id}`).toBeGreaterThan(0);
        expect(w.moves[id].looks.length, `${l} ${id}`).toBe(en.moves[id].looks.length);
        expect(w.moves[id].cannot.length, `${l} ${id}`).toBe(en.moves[id].cannot.length);
      }
      const texts = [...Object.values(w.ui), ...Object.values(w.cues), ...Object.values(w.rules), ...Object.values(w.parts)];
      for (const t of texts) expect(t.trim().length, l).toBeGreaterThan(0);
    }
  });

  it('every cue and every rule the coach can name has a sentence in every language', () => {
    const rules = Object.values(FORM_MOVES).flatMap((m) => m.rules.map((r) => r.id));
    for (const l of LANGS) {
      for (const c of cueCodes()) expect(FORM_WORDS[l].cues[c], `${l} cue ${c}`).toBeTruthy();
      for (const r of rules) expect(FORM_WORDS[l].rules[r], `${l} rule ${r}`).toBeTruthy();
    }
  });

  it('keeps the placeholders of every sentence in every language', () => {
    const ph = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const l of LANGS) for (const [k, v] of Object.entries(FORM_WORDS.en.ui)) expect(ph(FORM_WORDS[l].ui[k as keyof typeof FORM_WORDS.en.ui]), `${l} ${k}`).toEqual(ph(v));
    expect(fill('{reps} reps, {clean} clean', { reps: 5, clean: 3 })).toBe('5 reps, 3 clean');
  });

  it('never names the technology, never promises health or injury results, and short cues stay short', () => {
    // the short forms in capitals as whole words (Turkish "İki" must not trip "KI"), the long ones in any case
    const acronyms = /(^|[^\p{L}])(AI|A\.I\.|IA|KI)(?!\p{L})/u;
    const banned = /yapay zek|artificial|künstlich|inteligencia artificial|intelligence artificielle|injur|sakatl|verletz|lesi[oó]n|blessure|heal|tedavi|therap|terapi|medical|tıbbi|médic|medizin/i;
    for (const l of LANGS) {
      const w = FORM_WORDS[l];
      const all = JSON.stringify(w);
      expect(all, l).not.toMatch(acronyms);
      expect(all, l).not.toMatch(banned);
      for (const c of Object.values(w.cues)) expect(c.length, `${l}: ${c}`).toBeLessThanOrEqual(60);
    }
  });

  it('writes Turkish with its own letters', () => {
    const tr = JSON.stringify(FORM_WORDS.tr);
    expect(tr).toMatch(/[çğıöşüİ]/);
    expect(tr).not.toMatch(/\bDizlerini ayak uclarinla|\bGogsunu|\bKalcani/);
  });
});
