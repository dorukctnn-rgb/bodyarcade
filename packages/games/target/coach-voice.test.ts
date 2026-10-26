// The coach's voice: the clips are fetched once and played at the right level; a muted app is silent (the fallback voice too); quiet mode is
// softer; a call that is late is dropped, never queued; a clip that cannot be had is spoken by the browser's voice where it has one.
import { describe, expect, it } from 'vitest';
import { CALL_IDS, type CallId } from './coach.ts';
import {
  CLIP_GAIN, QUIET_GAIN, STALE_MS, browserSpeech, clipName, createCoachVoice, isMuted, pickVoiceLang, speechTag,
  type SpeechLike, type VoiceAudio, type VoicePack,
} from './coach-voice.ts';

const pack = (langs: string[] = ['en', 'tr'], missing: CallId[] = []): VoicePack => ({
  langs,
  clip: (lang, id) => (langs.includes(lang) && !missing.includes(id) ? { url: `/voice/${lang}/${id}.mp3`, ms: 300 } : null),
});

interface FakeAudio extends VoiceAudio {
  muted: boolean;
  volume: number;
  added: string[];
  played: { name: string; gain: number | undefined }[];
  decodeFails: Set<string>;
  allowPlay: boolean;
}
function audio(o: Partial<Pick<FakeAudio, 'muted' | 'volume' | 'allowPlay'>> = {}): FakeAudio {
  const have = new Set<string>();
  const a: FakeAudio = {
    muted: o.muted ?? false, volume: o.volume ?? 0.8, added: [], played: [], decodeFails: new Set(), allowPlay: o.allowPlay ?? true,
    async addClip(name) { if (a.decodeFails.has(name)) return false; have.add(name); a.added.push(name); return true; },
    hasClip: (name) => have.has(name),
    playClip(name, opt) { if (!a.allowPlay) return false; a.played.push({ name, gain: opt?.gain }); return true; },
  };
  return a;
}

interface FakeSpeech extends SpeechLike { spoken: { text: string; lang: string; volume: number; rate: number }[]; cancels: number; voices: string[] }
function speech(voices: string[] = ['en-US', 'tr-TR']): FakeSpeech {
  const s: FakeSpeech = {
    spoken: [], cancels: 0, voices,
    hasVoice: (tag) => s.voices.some((v) => v.slice(0, 2) === tag.slice(0, 2)),
    speak(text, o) { s.spoken.push({ text, ...o }); return true; },
    cancel() { s.cancels++; },
  };
  return s;
}

const fetcher = (fail: string[] = []) => {
  const urls: string[] = [];
  return { urls, fetchBytes: async (url: string): Promise<ArrayBuffer> => { urls.push(url); if (fail.some((f) => url.includes(f))) throw new Error('404'); return new ArrayBuffer(10); } };
};

const make = (a: FakeAudio, o: Partial<Parameters<typeof createCoachVoice>[0]> = {}) => {
  const f = fetcher();
  const v = createCoachVoice({ audio: a, pack: pack(), lang: 'en', quiet: false, text: (l, id) => `${l}:${id}`, fetchBytes: f.fetchBytes, speech: null, ...o });
  return { v, f };
};

describe('which language', () => {
  it('speaks the app language where the pack has a voice in it, English otherwise', () => {
    expect(pickVoiceLang(pack(), 'tr')).toBe('tr');
    expect(pickVoiceLang(pack(), 'en')).toBe('en');
    for (const l of ['de', 'es', 'fr', '', 'xx']) expect(pickVoiceLang(pack(), l)).toBe('en');
    expect(pickVoiceLang(pack(['tr']), 'de')).toBe('tr');
    expect(speechTag('tr')).toBe('tr-TR');
    expect(speechTag('en')).toBe('en-US');
  });
});

describe('loading', () => {
  it('fetches the 15 clips of the language once each, decodes them under their names, and is ready', async () => {
    const a = audio();
    const { v, f } = make(a, { lang: 'tr' });
    expect(v.state).toBe('idle');
    const p = v.preload();
    expect(v.state).toBe('loading');
    await p;
    expect(v.state).toBe('ready');
    expect(f.urls.length).toBe(15);
    expect(f.urls.every((u) => u.startsWith('/voice/tr/'))).toBe(true);
    expect(a.added.sort()).toEqual(CALL_IDS.map((id) => clipName('tr', id)).sort());
    await v.preload();
    expect(f.urls.length).toBe(15);               // once
  });

  it('leaves out what the audio already has (a second round of the same page) and what the pack has no clip for', async () => {
    const a = audio();
    const first = make(a);
    await first.v.preload();
    const second = make(a);
    await second.v.preload();
    expect(second.f.urls.length).toBe(0);
    expect(second.v.state).toBe('ready');
    const b = audio();
    const { v, f } = make(b, { pack: pack(['en', 'tr'], ['rest', 'n6']) });
    await v.preload();
    expect(f.urls.length).toBe(13);
  });

  it('one clip that does not load costs one call, not the voice; none at all makes the state failed', async () => {
    const a = audio();
    const f = fetcher(['/n3.']);
    const errors: unknown[] = [];
    const v = createCoachVoice({ audio: a, pack: pack(), lang: 'en', quiet: false, text: () => '', fetchBytes: f.fetchBytes, speech: null, onError: (e) => errors.push(e) });
    await v.preload();
    expect(v.state).toBe('ready');
    expect(errors.length).toBe(1);
    expect(a.hasClip!(clipName('en', 'n3'))).toBe(false);
    expect(a.hasClip!(clipName('en', 'n2'))).toBe(true);
    const b = audio();
    const g = createCoachVoice({ audio: b, pack: pack(), lang: 'en', quiet: false, text: () => '', fetchBytes: fetcher(['/voice/']).fetchBytes, speech: null, onError: () => undefined });
    await g.preload();
    expect(g.state).toBe('failed');
    const c = audio();
    c.decodeFails = new Set(CALL_IDS.map((id) => clipName('en', id)));
    const h = make(c).v;
    await h.preload();
    expect(h.state).toBe('failed');
  });

  it('an audio object that cannot hold clips (a stand-in, a very old browser) is a failed voice, not an error', async () => {
    const v = createCoachVoice({ audio: { muted: false }, pack: pack(), lang: 'en', quiet: false, text: () => '', speech: null });
    await expect(v.preload()).resolves.toBeUndefined();
    expect(v.state).toBe('failed');
    expect(v.say('n1')).toBe('none');
  });
});

describe('saying a call', () => {
  it('plays the clip of the call at the level of the voice', async () => {
    const a = audio();
    const { v } = make(a);
    await v.preload();
    expect(v.say('n2')).toBe('clip');
    expect(v.say('slipL')).toBe('clip');
    expect(a.played).toEqual([{ name: 'coach/en/n2', gain: CLIP_GAIN }, { name: 'coach/en/slipL', gain: CLIP_GAIN }]);
  });

  it('quiet mode is softer, by a set factor, and can be switched when a new run starts', async () => {
    const a = audio();
    const { v } = make(a, { quiet: true });
    await v.preload();
    v.say('n1');
    v.setQuiet(false);
    v.say('n1');
    v.setQuiet(true);
    v.say('n1');
    expect(a.played.map((p) => p.gain)).toEqual([CLIP_GAIN * QUIET_GAIN, CLIP_GAIN, CLIP_GAIN * QUIET_GAIN]);
    expect(QUIET_GAIN).toBeLessThan(1);
    expect(QUIET_GAIN).toBeGreaterThan(0);
  });

  it('is silent when the app is muted or its volume is 0: no clip, and not the fallback voice either', async () => {
    const a = audio({ muted: true });
    const sp = speech();
    const { v } = make(a, { speech: sp });
    await v.preload();
    expect(v.say('n1')).toBe('muted');
    a.muted = false;
    a.volume = 0;
    expect(v.say('n1')).toBe('muted');
    a.volume = 0.5;
    expect(v.say('n1')).toBe('clip');
    expect(a.played.length).toBe(1);
    expect(sp.spoken.length).toBe(0);
    expect(isMuted({ muted: true })).toBe(true);
    expect(isMuted({ volume: 0 })).toBe(true);
    expect(isMuted({})).toBe(false);
    // the fallback is muted too
    const b = audio({ muted: true });
    const sp2 = speech();
    const w = make(b, { speech: sp2, pack: pack(['en'], [...CALL_IDS]) });
    await w.v.preload();
    expect(w.v.say('n1')).toBe('muted');
    expect(sp2.spoken.length).toBe(0);
  });

  it('drops a call that is late instead of speaking it over the beat', async () => {
    const a = audio();
    const { v } = make(a);
    await v.preload();
    expect(v.say('n1', { lateMs: STALE_MS })).toBe('clip');
    expect(v.say('n1', { lateMs: STALE_MS + 1 })).toBe('stale');
    expect(v.say('n1', { lateMs: 5000 })).toBe('stale');
    expect(a.played.length).toBe(1);
  });

  it('says nothing, and keeps nothing waiting, while the clips are still on their way', async () => {
    const a = audio();
    const sp = speech();
    const { v } = make(a, { speech: sp });
    expect(v.say('n1')).toBe('loading');
    const p = v.preload();
    expect(v.say('n1')).toBe('loading');
    await p;
    expect(a.played.length).toBe(0);
    expect(sp.spoken.length).toBe(0);
    expect(v.say('n1')).toBe('clip');           // the call that comes next is spoken as usual
  });

  it('when the audio is blocked (locked, suspended, full) the call is not spoken by another route', async () => {
    const a = audio({ allowPlay: false });
    const sp = speech();
    const { v } = make(a, { speech: sp });
    await v.preload();
    expect(v.say('n1')).toBe('blocked');
    expect(sp.spoken.length).toBe(0);
  });

  it('after dispose it says nothing and silences the fallback', async () => {
    const a = audio();
    const sp = speech();
    const { v } = make(a, { speech: sp });
    await v.preload();
    v.dispose();
    expect(v.say('n1')).toBe('none');
    expect(sp.cancels).toBe(1);
    v.stop();
    expect(sp.cancels).toBe(2);
  });
});

describe('the fallback voice', () => {
  it('speaks a call whose clip is missing, in the language, one at a time, at the level of the app', async () => {
    const a = audio({ volume: 0.6 });
    const sp = speech();
    const { v } = make(a, { speech: sp, lang: 'tr', pack: pack(['en', 'tr'], ['n3']) });
    await v.preload();
    expect(v.say('n3')).toBe('speech');
    expect(v.say('n3')).toBe('speech');
    expect(sp.cancels).toBe(2);                 // it never queues: what it was saying is cut before it speaks again
    expect(sp.spoken[0]).toMatchObject({ text: 'tr:n3', lang: 'tr-TR', rate: 1.3 });
    expect(sp.spoken[0]!.volume).toBeCloseTo(0.6 * CLIP_GAIN, 5);
    expect(v.say('rest')).toBe('clip');
  });

  it('is the whole voice when no clip could be had, with its own pace for words that are not numbers, and softer in quiet mode', async () => {
    const a = audio({ volume: 1 });
    a.decodeFails = new Set(CALL_IDS.map((id) => clipName('en', id)));
    const sp = speech();
    const { v } = make(a, { speech: sp, quiet: true });
    await v.preload();
    expect(v.state).toBe('failed');
    expect(v.say('slipR')).toBe('speech');
    expect(sp.spoken[0]).toMatchObject({ text: 'en:slipR', lang: 'en-US', rate: 1.1 });
    expect(sp.spoken[0]!.volume).toBeCloseTo(CLIP_GAIN * QUIET_GAIN, 5);
  });

  it('is not used for a language the device has no voice for, nor without speech at all: the call is shown and not heard', async () => {
    const a = audio();
    const sp = speech(['en-US']);
    const { v } = make(a, { speech: sp, lang: 'tr', pack: pack(['en', 'tr'], [...CALL_IDS]) });
    await v.preload();
    expect(v.say('n1')).toBe('none');
    expect(sp.spoken.length).toBe(0);
    const w = make(a, { speech: null, pack: pack(['en'], [...CALL_IDS]) });
    await w.v.preload();
    expect(w.v.say('n1')).toBe('none');
  });
});

describe('the browser speech', () => {
  const synth = (voices: { lang: string }[], throws = false) => {
    const calls: string[] = [];
    class Utterance { text: string; lang = ''; volume = 1; rate = 1; constructor(t: string) { this.text = t; } }
    return {
      calls,
      g: {
        speechSynthesis: { getVoices: () => voices, speak: (u: Utterance) => { if (throws) throw new Error('x'); calls.push(`${u.lang}|${u.text}|${u.volume}|${u.rate}`); }, cancel: () => { calls.push('cancel'); } },
        SpeechSynthesisUtterance: Utterance,
      } as unknown as Parameters<typeof browserSpeech>[0],
    };
  };

  it('is null where there is none, and wraps the browser where there is', () => {
    expect(browserSpeech({})).toBeNull();
    const s = synth([{ lang: 'en-GB' }, { lang: 'tr-TR' }]);
    const sp = browserSpeech(s.g)!;
    expect(sp.hasVoice('tr-TR')).toBe(true);
    expect(sp.hasVoice('en-US')).toBe(true);
    expect(sp.hasVoice('de-DE')).toBe(false);
    expect(sp.speak('Bir', { lang: 'tr-TR', volume: 2, rate: 1.3 })).toBe(true);
    sp.cancel();
    expect(s.calls).toEqual(['tr-TR|Bir|1|1.3', 'cancel']);
  });

  it('with the voice list not loaded yet, English is a safe guess and another language is not', () => {
    const sp = browserSpeech(synth([]).g)!;
    expect(sp.hasVoice('en-US')).toBe(true);
    expect(sp.hasVoice('tr-TR')).toBe(false);
  });

  it('a browser that throws is a call that is not heard, not an error', () => {
    const sp = browserSpeech(synth([{ lang: 'en-US' }], true).g)!;
    expect(sp.speak('One', { lang: 'en-US', volume: 1, rate: 1 })).toBe(false);
  });
});
