// The coach inside the game: the calls the engine makes reach the voice and the picture in the right language, on the game clock, with the sound
// and quiet settings obeyed, whatever the voice does; and a run that is paused, restored or run slowly neither repeats nor drifts.
import { describe, expect, it } from 'vitest';
import type { AudioApi, GameContext, GameEvent, GameManifest, Hud, InputFrame, Rng, StartOptions } from '../../core/types/index.ts';
import { FIXED_DT } from '../../core/types/index.ts';
import { rngStream } from '../../core/loop/rng.ts';
import { profileOf, SHAPE_UPPER } from '../../core/moves/testing/rig.ts';
import { CALL_IDS, MAX_CLIP_MS, callKind, type CallId } from './coach.ts';
import { CLIP_GAIN, QUIET_GAIN, STALE_MS, clipName, type SpeechLike, type VoicePack } from './coach-voice.ts';
import { createTargetGame, type TargetView, type ViewFrame } from './game.ts';
import { padWorkRules } from './pad-work.ts';
import { starCatchRules } from './star-catch.ts';
import { TARGET_STRINGS, type Lang } from './strings.ts';
import { frameOf } from './testing/body.ts';
import type { BaseSpec, Rules } from './types.ts';

const MANIFEST: GameManifest = {
  id: 'pad-work', template: 'target', version: 1, title: 'Pad Work', regions: ['arms'], framing: 'upper', seated: true, lowImpact: true, silentSafe: true,
  durationSec: 60, met: 5, detectors: [{ id: 'handHit' }], free: false, modes: ['solo', 'local2'], seo: { slug: 'pad-work', keywords: ['x'] },
};
const START = (o: Partial<StartOptions> = {}): StartOptions => ({ seed: 1, difficulty: 'hard', seated: false, mode: 'solo', profile: profileOf(SHAPE_UPPER, 'upper'), ...o });

const PACK: VoicePack = { langs: ['en', 'tr'], clip: (lang, id) => ({ url: `/v/${lang}/${id}.mp3`, ms: MAX_CLIP_MS[callKind(id)] - 50 }) };

interface Sound { name: string; gain: number | undefined; at: number }
interface Rig {
  ctx: GameContext;
  played: string[];
  clips: Sound[];
  captions: { id: string; text: string; t: number }[];
  announced: string[];
  audio: { muted: boolean; volume: number; blocked: boolean; clipFailures: Set<string> };
  fetched: string[];
  spoken: { text: string; lang: string }[];
  speech: SpeechLike;
  /** The game's sim time as the last render saw it. */
  now: { t: number };
}

/** How the shell translates: `target.<key>` from the tables of one language (the English of the game when that has none). */
const shellT = (lang: Lang | null): GameContext['t'] => (key, vars) => {
  if (!lang) return key;
  const k = key.replace(/^target\./, '');
  const msg = TARGET_STRINGS[lang][k];
  return msg === undefined ? key : msg.replace(/\{(\w+)\}/g, (_m, n: string) => String(vars?.[n] ?? ''));
};

function rig(o: { lang?: Lang | null; silent?: boolean; muted?: boolean; volume?: number; speechVoices?: string[] } = {}): Rig {
  const played: string[] = [], clips: Sound[] = [], captions: Rig['captions'] = [], announced: string[] = [], fetched: string[] = [], spoken: { text: string; lang: string }[] = [];
  const have = new Set<string>();
  const now = { t: 0 };
  const audioState = { muted: o.muted ?? false, volume: o.volume ?? 0.8, blocked: false, clipFailures: new Set<string>() };
  const audio = {
    play: (n: string) => { played.push(n); },
    unlock() {},
    clock: () => ({ now: () => 0, schedule() {}, latencyMs: 0 }),
    get muted() { return audioState.muted; },
    get volume() { return audioState.volume; },
    async addClip(name: string) { if (audioState.clipFailures.has(name)) return false; have.add(name); return true; },
    hasClip: (name: string) => have.has(name),
    playClip(name: string, opt?: { gain?: number }) { if (audioState.blocked) return false; clips.push({ name, gain: opt?.gain, at: now.t }); return true; },
  };
  const speech: SpeechLike = {
    hasVoice: (tag) => (o.speechVoices ?? ['en-US', 'tr-TR']).some((v) => v.slice(0, 2) === tag.slice(0, 2)),
    speak: (text, s) => { spoken.push({ text, lang: s.lang }); return true; },
    cancel() {},
  };
  const streams = new Map<string, Rng>();
  const hud: Hud = { set() {}, announce: (t) => { announced.push(t); }, toast() {} };
  const ctx: GameContext = {
    pose: {} as GameContext['pose'], input: {} as GameContext['input'], hud, audio: audio as unknown as AudioApi,
    store: { get: <T>(_k: string, _s: unknown, f: T) => f, set() {}, remove() {} },
    rng: (name) => { let s = streams.get(name); if (!s) { s = rngStream(1, name); streams.set(name, s); } return s; },
    flags: { reducedMotion: false, silent: o.silent ?? false, seated: false },
    t: shellT(o.lang === undefined ? null : o.lang),
  };
  return { ctx, played, clips, captions, announced, audio: audioState, fetched, spoken, speech, now };
}

/** The picture: writes down the captions it is told to draw, as the mirror view does (it shows `say('call.<id>')`). */
function view(r: Rig): () => TargetView {
  return () => ({
    begin() {},
    draw(v, f: ViewFrame) {
      r.now.t = v.t;
      for (const e of f.events) if (e.type === 'call') r.captions.push({ id: e['id'] as string, text: f.say(`call.${e['id'] as string}`), t: v.t });
    },
    dispose() {},
  });
}

const idleFrame = (k: number): InputFrame => frameOf(k, {});

async function make(r: Rig, o: { voice?: boolean; io?: boolean; rules?: Rules<never>; rounds?: number } = {}) {
  const rules = (o.rules ?? padWorkRules) as unknown as Rules<BaseSpec>;
  const g = createTargetGame(MANIFEST, rules, {
    rounds: o.rounds ?? 1,
    view: view(r),
    ...(o.voice === false ? {} : { voice: PACK }),
    voiceIo: { fetchBytes: async (url: string) => { r.fetched.push(url); return new ArrayBuffer(8); }, speech: o.io === false ? null : r.speech },
  });
  await g.init(r.ctx);
  await settle();
  return g;
}

/** Lets the clips that init started loading finish (in a browser they are long done by the first call: the player is calibrated meanwhile). */
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

/** Steps and renders like the shell does: `renderEvery` steps per frame. Returns the sim time reached. */
function run(g: ReturnType<typeof createTargetGame>, r: Rig, seconds: number, o: { renderEvery?: number; from?: number } = {}): number {
  let k = o.from ?? 0;
  const until = (o.from ?? 0) + Math.round(seconds * 60);
  for (; k < until; k++) {
    const out = g.step(FIXED_DT, idleFrame(k + 1));
    if ((k + 1) % (o.renderEvery ?? 1) === 0) { r.now.t = g.engine!.t; g.render(0.5); }
    if (out.phase !== 'running') break;
  }
  r.now.t = g.engine!.t;
  g.render(1);
  return k;
}

const heard = (r: Rig): CallId[] => r.clips.map((c) => c.name.split('/')[2] as CallId);

describe('the calls reach the voice and the picture', () => {
  it('says each call that the engine makes, once, in order, with its clip (English), and shows the same calls as captions', async () => {
    const r = rig({ lang: 'en' });
    const g = await make(r);
    g.start(START());
    run(g, r, 55);
    const engine = g.engine!;
    const made = engine.calls.filter((c) => c.t <= engine.t);
    expect(made.length).toBeGreaterThan(40);
    expect(heard(r)).toEqual(made.map((c) => c.id));
    expect(r.captions.map((c) => c.id)).toEqual(made.map((c) => c.id));
    expect(r.clips.every((c) => c.name.startsWith('coach/en/'))).toBe(true);
    expect(r.clips.every((c) => c.gain === CLIP_GAIN)).toBe(true);
    expect(r.captions.find((c) => c.id === 'n1')!.text).toBe('One');
    expect(r.captions.find((c) => c.id === 'round1')!.text).toBe('Round one');
    expect(r.fetched.length).toBe(15);
    expect(r.spoken.length).toBe(0);
  });

  it('follows the app language: Turkish clips and Turkish words', async () => {
    const r = rig({ lang: 'tr' });
    const g = await make(r);
    g.start(START());
    run(g, r, 30);
    expect(r.clips.length).toBeGreaterThan(10);
    expect(r.clips.every((c) => c.name.startsWith('coach/tr/'))).toBe(true);
    expect(r.fetched.every((u) => u.startsWith('/v/tr/'))).toBe(true);
    expect(r.captions.find((c) => c.id === 'n2')!.text).toBe('İki');
    expect(r.captions.find((c) => c.id === 'round1')!.text).toBe('Birinci tur');
  });

  it('a language without a voice (German, Spanish, French) hears the English voice and reads its own captions', async () => {
    for (const [lang, two] of [['de', 'Zwei'], ['es', 'Dos'], ['fr', 'Deux']] as const) {
      const r = rig({ lang });
      const g = await make(r);
      g.start(START());
      run(g, r, 12);
      expect(r.clips.length, lang).toBeGreaterThan(3);
      expect(r.clips.every((c) => c.name.startsWith('coach/en/')), lang).toBe(true);
      expect(r.captions.find((c) => c.id === 'n2')!.text, lang).toBe(two);
    }
  });

  it('a shell that has not added the words of the game gets the English voice and English captions', async () => {
    const r = rig({ lang: null });
    const g = await make(r);
    g.start(START());
    run(g, r, 12);
    expect(r.clips.every((c) => c.name.startsWith('coach/en/'))).toBe(true);
    expect(r.captions.find((c) => c.id === 'n1')!.text).toBe('One');
  });

  it('plays the call on the frame after the step that made it: never later than a frame behind the game clock, on a slow device (3 steps a frame) too', async () => {
    for (const every of [1, 2, 3]) {
      const r = rig({ lang: 'en' });
      const g = await make(r);
      g.start(START());
      run(g, r, 40, { renderEvery: every });
      const due = new Map(g.engine!.calls.map((c, i) => [i, c.t]));
      expect(r.clips.length).toBeGreaterThan(20);
      r.clips.forEach((c, i) => {
        const late = c.at - (due.get(i) as number);
        expect(late, `every ${every} call ${i}`).toBeGreaterThanOrEqual(0);
        expect(late, `every ${every} call ${i}`).toBeLessThanOrEqual(every * (1000 / 60) + 1e-6);
      });
    }
  });

  it('keeps time over a whole two minute round: the last calls are no later than the first', async () => {
    const r = rig({ lang: 'en' });
    const g = await make(r, { rounds: 1 });
    // a 120 s round on its own
    const long = createTargetGame({ ...MANIFEST, durationSec: 120 }, padWorkRules as unknown as Rules<BaseSpec>, { rounds: 1, view: view(r), voice: PACK, voiceIo: { fetchBytes: async () => new ArrayBuffer(8), speech: null } });
    void g;
    await long.init(r.ctx);
    await settle();
    long.start(START({ difficulty: 'expert' }));
    run(long, r, 119.9, { renderEvery: 2 });
    const calls = long.engine!.calls;
    const late = r.clips.map((c, i) => c.at - (calls[i] as { t: number }).t);
    expect(late.length).toBeGreaterThan(150);
    const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
    expect(Math.abs(mean(late.slice(-30)) - mean(late.slice(0, 30)))).toBeLessThan(1000 / 60);
    expect(Math.max(...late)).toBeLessThanOrEqual(2 * (1000 / 60) + 1e-6);
  });
});

describe('the settings of the app', () => {
  it('a muted app plays no clip and speaks nothing, but every call is still a caption', async () => {
    const r = rig({ lang: 'en', muted: true, speechVoices: ['en-US'] });
    const g = await make(r);
    g.start(START());
    run(g, r, 25);
    expect(r.clips.length).toBe(0);
    expect(r.spoken.length).toBe(0);
    expect(r.captions.length).toBeGreaterThan(10);
    // the sound switched back on during the run: the calls that come next are heard
    r.audio.muted = false;
    run(g, r, 10, { from: 25 * 60 });
    expect(r.clips.length).toBeGreaterThan(2);
  });

  it('a volume of 0 is muted too', async () => {
    const r = rig({ lang: 'en', volume: 0 });
    const g = await make(r);
    g.start(START());
    run(g, r, 12);
    expect(r.clips.length).toBe(0);
    expect(r.captions.length).toBeGreaterThan(3);
  });

  it('quiet mode: the coach is softer, the captions are the same, and it is read from the run that starts', async () => {
    const quiet = rig({ lang: 'en', silent: true });
    const loud = rig({ lang: 'en' });
    for (const r of [quiet, loud]) { const g = await make(r); g.start(START()); run(g, r, 12); }
    expect(quiet.clips.length).toBe(loud.clips.length);
    expect(quiet.clips.every((c) => c.gain === CLIP_GAIN * QUIET_GAIN)).toBe(true);
    expect(loud.clips.every((c) => c.gain === CLIP_GAIN)).toBe(true);
    expect(quiet.captions).toEqual(loud.captions);
  });

  it('without a voice pack, or with a game that has no calls, nothing is heard and nothing fails; the captions stay', async () => {
    const none = rig({ lang: 'en' });
    const g = await make(none, { voice: false });
    g.start(START());
    run(g, none, 12);
    expect(none.clips.length + none.spoken.length + none.fetched.length).toBe(0);
    expect(none.captions.length).toBeGreaterThan(3);
    const star = rig({ lang: 'en' });
    const s = await make(star, { rules: starCatchRules as never });
    s.start(START());
    run(s, star, 12);
    expect(star.fetched.length + star.clips.length + star.captions.length).toBe(0);
  });
});

describe('when the voice cannot', () => {
  it('a clip that did not load is spoken by the browser where it has a voice for the language, and is silent where it has not', async () => {
    const r = rig({ lang: 'tr', speechVoices: ['en-US', 'tr-TR'] });
    r.audio.clipFailures.add(clipName('tr', 'n2'));
    const g = await make(r);
    g.start(START());
    run(g, r, 14);
    expect(r.spoken.length).toBeGreaterThan(1);
    expect(r.spoken.every((s) => s.lang === 'tr-TR' && s.text === 'İki')).toBe(true);
    expect(heard(r).includes('n2')).toBe(false);
    const q = rig({ lang: 'tr', speechVoices: ['en-US'] });
    q.audio.clipFailures.add(clipName('tr', 'n2'));
    const h = await make(q);
    h.start(START());
    run(h, q, 14);
    expect(q.spoken.length).toBe(0);
    expect(q.captions.filter((c) => c.id === 'n2').length).toBeGreaterThan(1);
  });

  it('a voice that throws, a fetch that fails and audio that is blocked never stop the round', async () => {
    const r = rig({ lang: 'en' });
    (r.ctx.audio as unknown as { playClip: () => boolean }).playClip = () => { throw new Error('no sound card'); };
    const g = await make(r);
    g.start(START());
    expect(() => run(g, r, 15)).not.toThrow();
    expect(r.captions.length).toBeGreaterThan(3);
    const b = rig({ lang: 'en' });
    b.audio.blocked = true;
    const h = await make(b);
    h.start(START());
    run(h, b, 8);
    expect(b.clips.length + b.spoken.length).toBe(0);
    const f = rig({ lang: 'en' });
    const k = createTargetGame(MANIFEST, padWorkRules as unknown as Rules<BaseSpec>, { rounds: 1, view: view(f), voice: PACK, voiceIo: { fetchBytes: async () => { throw new Error('offline'); }, speech: f.speech } });
    await k.init(f.ctx);
    await settle();
    k.start(START());
    run(k, f, 12);
    expect(f.spoken.length).toBeGreaterThan(2);       // the clips never came: the browser's voice does it
  });

  it('a page that stalled and then caught up drops the calls that are long gone and speaks the ones that are on time', async () => {
    const r = rig({ lang: 'en' });
    const g = await make(r);
    g.start(START());
    // 4 seconds of steps with no frame drawn (a hidden page), then a frame
    for (let k = 0; k < 60 * 12; k++) g.step(FIXED_DT, idleFrame(k + 1));
    const before = r.clips.length;
    g.render(0.5);
    const due = g.engine!.calls.filter((c) => c.t <= g.engine!.t);
    const recent = due.filter((c) => g.engine!.t - c.t <= STALE_MS);
    expect(due.length).toBeGreaterThan(recent.length);
    expect(r.clips.length - before).toBe(recent.length);
    expect(r.captions.length).toBe(due.length);       // the caption is the view's; it keeps the one that is on screen now
  });
});

describe('pause and resume', () => {
  it('a snapshot restored into another game continues the calls where they were: none repeated, none lost', async () => {
    const a = rig({ lang: 'en' });
    const g = await make(a);
    g.start(START());
    run(g, a, 14);
    const snap = JSON.parse(JSON.stringify(g.snapshot()));
    const first = heard(a).length;
    const b = rig({ lang: 'en' });
    const h = await make(b);
    h.restore(snap);
    run(h, b, 14, { from: 14 * 60 });
    run(g, a, 14, { from: 14 * 60 });
    expect(heard(b)).toEqual(heard(a).slice(first));
    expect(b.captions.map((c) => c.id)).toEqual(a.captions.slice(first).map((c) => c.id));
    expect(heard(b).length).toBeGreaterThan(5);
  });
});

describe('the events', () => {
  it('a call is an event of the step that made it, with its id and its time, and nothing else about a round changes', async () => {
    const r = rig({ lang: 'en' });
    const g = await make(r);
    g.start(START());
    const events: GameEvent[] = [];
    for (let k = 0; k < 60 * 6; k++) events.push(...g.step(FIXED_DT, idleFrame(k + 1)).events);
    const call = events.filter((e) => e.type === 'call');
    expect(call.length).toBeGreaterThan(1);
    expect(CALL_IDS as readonly string[]).toContain(call[0]!['id']);
    expect(typeof call[0]!['at']).toBe('number');
    expect(call[0]!['t']).toBeGreaterThanOrEqual(call[0]!['at'] as number);
  });
});
