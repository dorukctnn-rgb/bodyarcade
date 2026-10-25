// The coach's voice pack of Pad Work, as files: every clip of both languages is there, small, a well formed mp3 at the format it says, as long as
// clips.json says and no longer than the schedule counts on, says exactly what the caption says, and is the one the manifest hashes. The
// licence and source are written down next to them.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rngStream } from '../../../core/loop/rng.ts';
import { CALL_IDS, MAX_CLIP_MS, callKind, type CallId } from '../../target/coach.ts';
import { padCalls, planPads } from '../../target/pad-work.ts';
import { callText } from '../../target/strings.ts';
import { buildTimeline } from '../../target/timeline.ts';
import type { Level } from '../../target/types.ts';
import manifest from '../manifest.json' with { type: 'json' };
import { CLIPS, CLIP_URLS, COACH_PACK } from './pack.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const LANGS = ['en', 'tr'] as const;
const script = JSON.parse(readFileSync(join(dir, 'voice-script.json'), 'utf8')) as { model: string; voice: string; clips: Record<string, Record<string, { text: string; say: string; speeds: number[] }>> };
const norm = (s: string): string => s.toLowerCase().replace(/i̇/g, 'i').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).join(' ');

interface Mp3 { frames: number; version: number; layer: number; sampleRate: number; kbps: number; mono: boolean; clean: boolean; id3: boolean }

/** Walks the frames of an mp3 file: the format of the first, and whether the frames end exactly at the end of the file. */
function parseMp3(b: Buffer): Mp3 {
  const KBPS_V2L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const RATES_V2 = [22050, 24000, 16000];
  let at = 0, frames = 0;
  let first: Omit<Mp3, 'frames' | 'clean'> | null = null;
  const id3 = b.subarray(0, 3).toString('latin1') === 'ID3';
  if (id3) return { frames: 0, version: 0, layer: 0, sampleRate: 0, kbps: 0, mono: false, clean: false, id3 };
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff || ((b[at + 1] as number) & 0xe0) !== 0xe0) break;
    const version = ((b[at + 1] as number) >> 3) & 3;           // 2 = MPEG 2
    const layer = 4 - (((b[at + 1] as number) >> 1) & 3);       // 3 = layer III
    const bitrate = KBPS_V2L3[((b[at + 2] as number) >> 4) & 15] ?? 0;
    const rate = RATES_V2[((b[at + 2] as number) >> 2) & 3] ?? 0;
    const pad = ((b[at + 2] as number) >> 1) & 1;
    const mono = (((b[at + 3] as number) >> 6) & 3) === 3;
    if (!bitrate || !rate) break;
    // the first frame is the Xing/Info header (a frame of its own size); the second is the first of the sound
    if (frames === 1) first = { version, layer, sampleRate: rate, kbps: bitrate, mono, id3 };
    at += Math.floor((72000 * bitrate) / rate) + pad;
    frames++;
  }
  return { ...(first ?? { version: 0, layer: 0, sampleRate: 0, kbps: 0, mono: false, id3 }), frames, clean: at === b.length };
}

describe('the files', () => {
  it('has the 15 calls in each language, as a file, in the manifest, in the list of addresses, and in the pack', () => {
    for (const lang of LANGS) {
      const files = readdirSync(join(dir, lang)).filter((f) => f.endsWith('.mp3')).map((f) => f.replace('.mp3', '')).sort();
      expect(files, lang).toEqual([...CALL_IDS].sort());
      expect(Object.keys(CLIPS.clips[lang] ?? {}).sort(), lang).toEqual([...CALL_IDS].sort());
      for (const id of CALL_IDS) {
        expect(CLIP_URLS[`${lang}/${id}`], `${lang}/${id}`).toMatch(/\.mp3$/);
        expect(COACH_PACK.clip(lang, id), `${lang}/${id}`).toEqual({ url: CLIP_URLS[`${lang}/${id}`], ms: CLIPS.clips[lang]![id]!.ms });
      }
    }
    expect(Object.keys(CLIP_URLS).length).toBe(LANGS.length * CALL_IDS.length);
    expect(COACH_PACK.langs).toEqual([...LANGS]);
    expect(COACH_PACK.clip('de', 'n1')).toBeNull();
    expect(COACH_PACK.clip('en', 'nope' as CallId)).toBeNull();
  });

  it('is the file the manifest hashed, and small: a few kilobytes a call, under 80 KB a language', () => {
    for (const lang of LANGS) {
      let total = 0;
      for (const id of CALL_IDS) {
        const bytes = readFileSync(join(dir, lang, `${id}.mp3`));
        const m = CLIPS.clips[lang]![id]!;
        expect(bytes.length, `${lang}/${id}`).toBe(m.bytes);
        expect(createHash('sha256').update(bytes).digest('hex'), `${lang}/${id}`).toBe(m.sha256);
        expect(bytes.length, `${lang}/${id}`).toBeLessThan(9000);
        total += bytes.length;
      }
      expect(total, lang).toBeLessThan(80_000);
    }
  });

  it('is a well formed mono mp3 at 24 kHz and 40 kbit/s, with no tag in front (the first frame is the decoder\'s gapless header), as long as clips.json says', () => {
    for (const lang of LANGS) for (const id of CALL_IDS) {
      const m = parseMp3(readFileSync(join(dir, lang, `${id}.mp3`)));
      const w = `${lang}/${id}`;
      expect(m, w).toMatchObject({ version: 2, layer: 3, sampleRate: 24000, kbps: 40, mono: true, clean: true, id3: false });
      // 576 samples a frame at 24 kHz is 24 ms; the first frame carries the encoder's delay and length (Xing), the codec's delay is 1105 samples
      const sound = ((m.frames - 1) * 576 - 1105) / 24000 * 1000;
      expect(sound, w).toBeGreaterThanOrEqual(CLIPS.clips[lang]![id]!.ms - 30);
      expect(sound, w).toBeLessThanOrEqual(CLIPS.clips[lang]![id]!.ms + 80);
    }
  });
});

describe('the lengths', () => {
  it('no clip is longer than the schedule counts on for its kind, and none is clipped short', () => {
    for (const lang of LANGS) for (const id of CALL_IDS) {
      const ms = CLIPS.clips[lang]![id]!.ms;
      expect(ms, `${lang}/${id}`).toBeLessThanOrEqual(MAX_CLIP_MS[callKind(id)]);
      expect(ms, `${lang}/${id}`).toBeGreaterThan(callKind(id) === 'number' ? 120 : 250);
    }
  });

  it('a bag\'s call is over before the player\'s window opens, in both languages', () => {
    for (const lang of LANGS) for (const id of ['slipL', 'slipR', 'duck'] as const) expect(CLIPS.clips[lang]![id]!.ms + 290, `${lang}/${id}`).toBeLessThanOrEqual(1050);
  });
});

describe('the words', () => {
  it('each clip says what its caption says, in the language of the clip', () => {
    for (const lang of LANGS) for (const id of CALL_IDS) {
      expect(norm(CLIPS.clips[lang]![id]!.text), `${lang}/${id}`).toBe(norm(callText(lang, id)!));
    }
  });

  it('is rendered from the script the repository keeps: same words, same voice, same model', () => {
    const made = CLIPS as unknown as { model: string; voice: string };
    expect(made.model).toBe(script.model);
    expect(made.voice).toBe(script.voice);
    for (const lang of LANGS) for (const id of CALL_IDS) {
      const s = script.clips[lang]![id]!;
      expect(norm(s.say), `${lang}/${id}`).toBe(norm(CLIPS.clips[lang]![id]!.text));
      expect(s.speeds.length, `${lang}/${id}`).toBeGreaterThan(0);
    }
  });

  it('has no dash, arrow, emoji or exclamation mark in what a player can read', () => {
    for (const lang of LANGS) for (const id of CALL_IDS) expect(CLIPS.clips[lang]![id]!.text, `${lang}/${id}`).not.toMatch(/[!–—→\p{Extended_Pictographic}]/u);
  });
});

describe('what the coach reads aloud', () => {
  const NUMBERS: Record<(typeof LANGS)[number], string[]> = { en: ['One', 'Two', 'Three', 'Four', 'Five', 'Six'], tr: ['Bir', 'İki', 'Üç', 'Dört', 'Beş', 'Altı'] };
  const BAG: Record<string, Record<(typeof LANGS)[number], string>> = {
    slipL: { en: 'Slip left', tr: 'Sola kaç' }, slipR: { en: 'Slip right', tr: 'Sağa kaç' }, duck: { en: 'Duck', tr: 'Eğil' },
  };
  const tl = buildTimeline(420, 3, 30);

  it.each(['easy', 'normal', 'hard', 'expert'] as Level[])('%s: every combination is called one-two-three in order, in both languages, and every bag in the words of its prompt', (level) => {
    for (const seed of [1, 2, 3]) {
      const plan = planPads(rngStream(seed, 'course'), { level, timeline: tl, seated: false, quiet: false, feet: false, keyboard: false, players: 1, hz: 30 });
      const calls = padCalls(plan, tl);
      const spoken = (lang: (typeof LANGS)[number], c: { id: CallId }): string => CLIPS.clips[lang]![c.id]!.text;
      const sizes = new Set<number>();
      let combos = 0, bags = 0;
      const byCombo = new Map<number, typeof calls>();
      for (const c of calls) {
        const spec = c.plan === undefined ? undefined : plan[c.plan];
        if (!spec) continue;
        if (spec.kind === 'bag') {
          bags++;
          for (const lang of LANGS) expect(spoken(lang, c), `${level} ${seed} ${lang} bag`).toBe(BAG[spec.need as string]![lang]);
        } else {
          byCombo.set(spec.combo, [...(byCombo.get(spec.combo) ?? []), c]);
        }
      }
      for (const group of byCombo.values()) {
        combos++;
        sizes.add(group.length);
        for (const lang of LANGS) expect(group.map((c) => spoken(lang, c)).join(', '), `${level} ${seed} ${lang}`).toBe(NUMBERS[lang].slice(0, group.length).join(', '));
        for (let i = 1; i < group.length; i++) expect(group[i]!.t).toBeGreaterThan(group[i - 1]!.t);
      }
      expect(combos, `${level} ${seed}`).toBeGreaterThan(40);
      expect(Math.max(...sizes), level).toBeLessThanOrEqual(6);
      if (level === 'easy') expect(bags, 'no bags on easy').toBe(0); else expect(bags, level).toBeGreaterThan(0);
    }
  });
});

describe('the licence', () => {
  it('is written down: the model, its revision and licence, that the voice is synthetic and no real person\'s, and the fallback', () => {
    expect(existsSync(join(dir, 'CREDITS.md'))).toBe(true);
    const text = readFileSync(join(dir, 'CREDITS.md'), 'utf8');
    for (const must of [
      'Supertonic 3', 'OpenRAIL-M', 'synthetic', 'not the voice of any real person', 'speech synthesis', script.voice,
      'https://huggingface.co/Supertone/supertonic-3/blob/main/LICENSE', 'Section 6', 'Attachment A (e)', 'Commercial use is allowed', '724fb5abbf5502583fb520898d45929e62f02c0b',
    ]) expect(text, must).toContain(must);
    expect(statSync(join(dir, 'render-voice.py')).size).toBeGreaterThan(1000);
  });

  it('the game page says that the coach is a synthetic voice, in both languages (Attachment A (e): machine generated content is said to be)', () => {
    const about = (manifest as { catalogue: { about: Record<string, string> } }).catalogue.about;
    expect(about.en).toMatch(/synthetic voice/);
    expect(about.tr).toMatch(/yapay bir sesle/);
  });
});
