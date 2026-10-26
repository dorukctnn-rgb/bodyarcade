// The coach's voice pack of Pad Work: where each clip is, and how long it plays. The files are next to this one (en/ and tr/), made by
// render-voice.py (see CREDITS.md for the voice and its licence); clips.json says what each one says and how long it is.
//
// Each address is written out as `new URL('./en/n1.mp3', import.meta.url)`, which is the form Vite follows: a build copies the file into
// the bundle's static folder under a hashed name and never inlines it (a clip is a few kilobytes), the dev server serves it from here. The
// game fetches them when it starts, never before, and only the language it speaks. A test keeps this list, the folder and clips.json equal.
import type { CallId } from '../../target/coach.ts';
import type { VoicePack } from '../../target/coach-voice.ts';
import clipsJson from './clips.json' with { type: 'json' };

export const CLIP_URLS: Readonly<Record<string, string>> = {
  'en/n1': new URL('./en/n1.mp3', import.meta.url).href,
  'en/n2': new URL('./en/n2.mp3', import.meta.url).href,
  'en/n3': new URL('./en/n3.mp3', import.meta.url).href,
  'en/n4': new URL('./en/n4.mp3', import.meta.url).href,
  'en/n5': new URL('./en/n5.mp3', import.meta.url).href,
  'en/n6': new URL('./en/n6.mp3', import.meta.url).href,
  'en/slipL': new URL('./en/slipL.mp3', import.meta.url).href,
  'en/slipR': new URL('./en/slipR.mp3', import.meta.url).href,
  'en/duck': new URL('./en/duck.mp3', import.meta.url).href,
  'en/round1': new URL('./en/round1.mp3', import.meta.url).href,
  'en/round2': new URL('./en/round2.mp3', import.meta.url).href,
  'en/round3': new URL('./en/round3.mp3', import.meta.url).href,
  'en/roundFinal': new URL('./en/roundFinal.mp3', import.meta.url).href,
  'en/last10': new URL('./en/last10.mp3', import.meta.url).href,
  'en/rest': new URL('./en/rest.mp3', import.meta.url).href,
  'tr/n1': new URL('./tr/n1.mp3', import.meta.url).href,
  'tr/n2': new URL('./tr/n2.mp3', import.meta.url).href,
  'tr/n3': new URL('./tr/n3.mp3', import.meta.url).href,
  'tr/n4': new URL('./tr/n4.mp3', import.meta.url).href,
  'tr/n5': new URL('./tr/n5.mp3', import.meta.url).href,
  'tr/n6': new URL('./tr/n6.mp3', import.meta.url).href,
  'tr/slipL': new URL('./tr/slipL.mp3', import.meta.url).href,
  'tr/slipR': new URL('./tr/slipR.mp3', import.meta.url).href,
  'tr/duck': new URL('./tr/duck.mp3', import.meta.url).href,
  'tr/round1': new URL('./tr/round1.mp3', import.meta.url).href,
  'tr/round2': new URL('./tr/round2.mp3', import.meta.url).href,
  'tr/round3': new URL('./tr/round3.mp3', import.meta.url).href,
  'tr/roundFinal': new URL('./tr/roundFinal.mp3', import.meta.url).href,
  'tr/last10': new URL('./tr/last10.mp3', import.meta.url).href,
  'tr/rest': new URL('./tr/rest.mp3', import.meta.url).href,
};

interface ClipsFile { clips: Record<string, Record<string, { text: string; ms: number; bytes: number; sha256: string }>> }
export const CLIPS = clipsJson as unknown as ClipsFile;

export const COACH_PACK: VoicePack = {
  langs: Object.keys(CLIPS.clips),
  clip(lang: string, id: CallId) {
    const c = CLIPS.clips[lang]?.[id];
    const url = CLIP_URLS[`${lang}/${id}`];
    return c && url ? { url, ms: c.ms } : null;
  },
};
