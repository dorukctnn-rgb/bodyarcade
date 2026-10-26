// The coach's voice: plays the clips of the calls the engine makes (coach.ts), and keeps to the player's settings while it does.
//
// - The sound comes from recorded clips (a voice pack: a few kilobytes a call, fetched when the game starts, decoded once by the audio kit
//   and played through the same master gain and limiter as every other sound), so it is the same voice on every device. Where a clip
//   cannot be had (the file did not load, the browser cannot decode it), the browser's own speech is the fallback, but only in a language
//   the device has a voice for; otherwise the call is shown and not heard.
// - The sound setting rules it: a muted kit (the app's sound switch) or a volume of 0 says nothing, and neither does the fallback, which
//   would otherwise go round the kit's mute. Quiet mode ("kind to the neighbours") makes the coach softer, not louder or absent.
// - Nothing is queued. A call that arrives more than STALE_MS after its time (a page that was stalled) is dropped rather than spoken late,
//   and the fallback cancels what it was saying before it speaks, so a slow or busy device can never fall behind the beat.
import type { CallId } from './coach.ts';
import { CALL_IDS } from './coach.ts';

/** One clip of a pack: where it is, and how long it plays (ms, measured when it was made). */
export interface VoiceClip { url: string; ms: number }

/** The clips of a coach, by language and call. */
export interface VoicePack {
  /** The languages the pack has a voice in. */
  readonly langs: readonly string[];
  clip(lang: string, id: CallId): VoiceClip | null;
}

/** What the voice asks of the audio object the game is handed. `muted` and `volume` and the clip methods are the audio kit's; a stand-in may have none. */
export interface VoiceAudio {
  readonly muted?: boolean;
  readonly volume?: number;
  addClip?(name: string, data: ArrayBuffer): Promise<boolean>;
  hasClip?(name: string): boolean;
  playClip?(name: string, o?: { when?: number; gain?: number }): boolean;
}

/** The browser's own speech, as little of it as the fallback needs. */
export interface SpeechLike {
  hasVoice(lang: string): boolean;
  /** Starts saying `text`; false when the browser refuses. */
  speak(text: string, o: { lang: string; volume: number; rate: number }): boolean;
  cancel(): void;
}

/** A call that comes this much later than its time (ms) is not spoken. */
export const STALE_MS = 400;
/** The level of a clip. The clips are made at a peak of about 0.5, which with the master gain sits at the limiter's threshold. */
export const CLIP_GAIN = 0.9;
/** Quiet mode: the coach is this much softer (a factor on the level). */
export const QUIET_GAIN = 0.5;

export type VoiceState = 'idle' | 'loading' | 'ready' | 'failed';
export type SayResult = 'clip' | 'speech' | 'muted' | 'stale' | 'loading' | 'blocked' | 'none';

export const clipName = (lang: string, id: CallId): string => `coach/${lang}/${id}`;

/** The language to speak: the one asked for when the pack has it, otherwise English (then the pack's first). */
export function pickVoiceLang(pack: VoicePack, wanted: string): string {
  if (pack.langs.includes(wanted)) return wanted;
  return pack.langs.includes('en') ? 'en' : (pack.langs[0] ?? 'en');
}

export const speechTag = (lang: string): string => (lang === 'tr' ? 'tr-TR' : lang === 'en' ? 'en-US' : lang);

export const isMuted = (a: VoiceAudio): boolean => a.muted === true || (typeof a.volume === 'number' && a.volume <= 0);

export interface CoachVoiceOptions {
  audio: VoiceAudio;
  pack: VoicePack;
  /** The language of the voice (use pickVoiceLang). */
  lang: string;
  quiet: boolean;
  /** The words of a call in a language, for the fallback voice. */
  text(lang: string, id: CallId): string;
  /** Gets the bytes of a clip; the default is fetch. */
  fetchBytes?: (url: string) => Promise<ArrayBuffer>;
  speech?: SpeechLike | null;
  onError?: (e: unknown) => void;
}

export interface CoachVoice {
  readonly state: VoiceState;
  readonly lang: string;
  /** Fetches and decodes the clips of the language. Safe to call again: it does the work once. */
  preload(): Promise<void>;
  setQuiet(quiet: boolean): void;
  /** Says a call that was due `lateMs` ago (default 0). */
  say(id: CallId, o?: { lateMs?: number }): SayResult;
  /** Silences the fallback voice. */
  stop(): void;
  dispose(): void;
}

const defaultFetch = async (url: string): Promise<ArrayBuffer> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`coach clip ${url}: ${r.status}`);
  return r.arrayBuffer();
};

export function createCoachVoice(o: CoachVoiceOptions): CoachVoice {
  const { audio, pack, lang } = o;
  const fetchBytes = o.fetchBytes ?? defaultFetch;
  let state: VoiceState = 'idle';
  let quiet = o.quiet;
  let loading: Promise<void> | null = null;
  let disposed = false;

  const level = (): number => CLIP_GAIN * (quiet ? QUIET_GAIN : 1);

  async function load(): Promise<void> {
    const add = audio.addClip?.bind(audio);
    const has = audio.hasClip?.bind(audio);
    if (!add || !has) { state = 'failed'; return; }
    state = 'loading';
    let ok = 0;
    await Promise.all(CALL_IDS.map(async (id) => {
      const c = pack.clip(lang, id);
      if (!c) return;
      const name = clipName(lang, id);
      if (has(name)) { ok++; return; }
      try {
        const bytes = await fetchBytes(c.url);
        if (disposed) return;
        if (await add(name, bytes)) ok++;
      } catch (e) { o.onError?.(e); }
    }));
    state = ok > 0 ? 'ready' : 'failed';
  }

  return {
    get state() { return state; },
    get lang() { return lang; },
    preload() {
      if (!loading) loading = load();
      return loading;
    },
    setQuiet(q) { quiet = q; },
    say(id, opts = {}) {
      if (disposed) return 'none';
      if ((opts.lateMs ?? 0) > STALE_MS) return 'stale';
      if (isMuted(audio)) return 'muted';
      const name = clipName(lang, id);
      if (audio.hasClip?.(name)) return audio.playClip?.(name, { gain: level() }) ? 'clip' : 'blocked';
      if (state === 'idle' || state === 'loading') return 'loading';
      // no clip for this call: the browser's own voice, in a language the device has a voice for
      const sp = o.speech;
      const tag = speechTag(lang);
      if (!sp || !sp.hasVoice(tag)) return 'none';
      sp.cancel();
      const vol = typeof audio.volume === 'number' ? audio.volume : 1;
      return sp.speak(o.text(lang, id), { lang: tag, volume: Math.min(1, vol * level()), rate: id[0] === 'n' ? 1.3 : 1.1 }) ? 'speech' : 'none';
    },
    stop() { o.speech?.cancel(); },
    dispose() { disposed = true; o.speech?.cancel(); },
  };
}

/** The browser's speech synthesis, or null where there is none. */
export function browserSpeech(g: Partial<Pick<typeof globalThis, 'speechSynthesis' | 'SpeechSynthesisUtterance'>> = globalThis): SpeechLike | null {
  const synth = g.speechSynthesis;
  const Utterance = g.SpeechSynthesisUtterance;
  if (!synth || typeof Utterance !== 'function') return null;
  return {
    hasVoice(tag) {
      try {
        const voices = synth.getVoices();
        // the list can be empty until the browser has loaded it: English is the safe guess, another language needs a voice to be seen
        if (voices.length === 0) return tag.toLowerCase().startsWith('en');
        const primary = tag.toLowerCase().slice(0, 2);
        return voices.some((v) => v.lang.toLowerCase().startsWith(primary));
      } catch { return false; }
    },
    speak(text, s) {
      try {
        const u = new Utterance(text);
        u.lang = s.lang;
        u.volume = Math.min(1, Math.max(0, s.volume));
        u.rate = s.rate;
        synth.speak(u);
        return true;
      } catch { return false; }
    },
    cancel() { try { synth.cancel(); } catch { /* nothing to cancel */ } },
  };
}
