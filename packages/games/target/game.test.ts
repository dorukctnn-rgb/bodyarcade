// The three games as Game objects: the contract (init, start, step, render, snapshot, restore, summary, dispose), the HUD
// and the sounds they produce, the words (all five languages, within the text budgets), the variants (seated, quiet,
// keyboard, two players) and a whole run through the Session with a scripted player.
import { describe, expect, it } from 'vitest';
import type { AudioApi, BodyProfile, GameContext, GameEvent, GameManifest, Hud, InputFrame, PlayerSlot, PoseFrame, PoseService, Rng, StartOptions } from '../../core/types/index.ts';
import { FIXED_DT } from '../../core/types/index.ts';
import { rngStream } from '../../core/loop/rng.ts';
import { profileOf, SHAPE_UPPER } from '../../core/moves/testing/rig.ts';
import { createTargetGame, type TargetGame, type TargetView, type ViewFrame } from './game.ts';
import { padWorkRules, type PadSpec } from './pad-work.ts';
import { reactionTagRules, type LightSpec } from './reaction-tag.ts';
import { starCatchRules, type StarSpec } from './star-catch.ts';
import { english, TARGET_STRINGS, TARGET_NAMESPACE, type Lang } from './strings.ts';
import { frame2, frameOf, VirtualBody } from './testing/body.ts';
import { Chaser } from './testing/bots.ts';
import { play, seenOf, setup } from './testing/play.ts';
import { levelOf, type BaseSpec, type Rules, type ViewState } from './types.ts';
import { TargetEngine } from './engine.ts';

const MANIFEST = (id: string, durationSec: number, o: Partial<GameManifest> = {}): GameManifest => ({
  id, template: 'target', version: 1, title: id, regions: ['arms'], framing: 'upper', seated: true, lowImpact: true, silentSafe: true,
  durationSec, met: 4, detectors: [{ id: 'handHit' }], free: true, modes: ['solo', 'local2'], seo: { slug: id, keywords: ['x'] }, ...o,
});

interface Fake {
  ctx: GameContext;
  hud: [string, unknown][];
  played: string[];
  announced: string[];
  duo: [PlayerSlot, string, unknown][];
  frames: ((f: PoseFrame) => void)[];
}

function fake(seed: number, o: { silent?: boolean; seated?: boolean; t?: GameContext['t']; duoHud?: boolean; pose?: boolean } = {}): Fake {
  const hud: [string, unknown][] = [], played: string[] = [], announced: string[] = [], duo: [PlayerSlot, string, unknown][] = [];
  const frames: ((f: PoseFrame) => void)[] = [];
  const streams = new Map<string, Rng>();
  const h: Hud & { setPlayer?: (p: PlayerSlot, s: string, v: unknown) => void } = {
    set: (slot, v) => { hud.push([slot, v]); },
    announce: (text) => { announced.push(text); },
    toast() {},
  };
  if (o.duoHud) h.setPlayer = (p, s, v) => { duo.push([p, s, v]); };
  const pose = o.pose === false ? ({} as PoseService) : ({ onFrame: (cb: (f: PoseFrame) => void) => { frames.push(cb); return () => { frames.splice(frames.indexOf(cb), 1); }; } } as unknown as PoseService);
  const ctx: GameContext = {
    pose, input: {} as GameContext['input'], hud: h, audio: { play: (n: string) => { played.push(n); }, unlock() {}, clock: () => ({ now: () => 0, schedule() {}, latencyMs: 0 }) } as AudioApi,
    store: { get: <T>(_k: string, _s: unknown, f: T) => f, set() {}, remove() {} },
    rng: (name) => { let s = streams.get(name); if (!s) { s = rngStream(seed, name); streams.set(name, s); } return s; },
    flags: { reducedMotion: false, silent: o.silent ?? false, seated: o.seated ?? false },
    t: o.t ?? ((k: string) => k),
  };
  return { ctx, hud, played, announced, duo, frames };
}

const START = (o: Partial<StartOptions> = {}): StartOptions => ({ seed: 1, difficulty: 'normal', seated: false, mode: 'solo', profile: profileOf(SHAPE_UPPER, 'upper'), ...o });

type Make = (m: GameManifest, view?: () => TargetView | null) => TargetGame<BaseSpec>;
const GAMES: { id: string; make: Make; rules: Rules<never>; seconds: number }[] = [
  { id: 'star-catch', make: (m, v) => createTargetGame(m, starCatchRules as unknown as Rules<BaseSpec>, { rounds: 1, ...(v ? { view: v } : {}) }), rules: starCatchRules as never, seconds: 20 },
  { id: 'pad-work', make: (m, v) => createTargetGame(m, padWorkRules as unknown as Rules<BaseSpec>, { rounds: 1, ...(v ? { view: v } : {}) }), rules: padWorkRules as never, seconds: 20 },
  { id: 'reaction-tag', make: (m, v) => createTargetGame(m, reactionTagRules as unknown as Rules<BaseSpec>, { rounds: 1, ...(v ? { view: v } : {}) }), rules: reactionTagRules as never, seconds: 20 },
];

/** Plays a Game with a chasing player (stars and lights) or a punching one is not needed here: chase whatever the view shows. */
async function playOut(g: TargetGame<BaseSpec>, f: Fake, o: { mode?: 'perfect' | 'idle'; render?: number; start?: Partial<StartOptions>; maxSteps?: number } = {}): Promise<{ events: GameEvent[]; steps: number }> {
  await g.init(f.ctx);
  g.start(START(o.start));
  const two = (o.start?.mode ?? 'solo') === 'local2';
  const bodies = [new VirtualBody({ clockOffset: 5000 }), new VirtualBody({ clockOffset: 7000 })];
  const chasers = [new Chaser(o.mode ?? 'perfect', 1), new Chaser(o.mode ?? 'perfect', 2)];
  const events: GameEvent[] = [];
  let k = 0;
  let phase = 'running';
  while (phase === 'running' && k < (o.maxSteps ?? 60 * 400)) {
    k++;
    const v = (g.engine as TargetEngine<BaseSpec>).view();
    const chans = [0, 1].map((i) => { const l = v.lanes[i]; if (l) chasers[i]!.steer(bodies[i]!, seenOf(l)); return bodies[i]!.step(k); });
    const input: InputFrame = two ? frame2(k, chans[0]!, chans[1]!) : frameOf(k, chans[0]!);
    const r = g.step(FIXED_DT, input);
    events.push(...r.events);
    phase = r.phase;
    if (k % (o.render ?? 2) === 0) g.render(0.5);
  }
  g.render(1);
  return { events, steps: k };
}

describe.each(GAMES)('$id as a Game', ({ id, make, seconds }) => {
  const manifest = MANIFEST(id, seconds);

  it('needs init before start and start before step', async () => {
    const g = make(manifest);
    expect(() => g.start(START())).toThrow(/init/);
    await g.init(fake(1).ctx);
    expect(() => g.step(FIXED_DT, frameOf(1, {}))).toThrow(/start/);
    expect(() => g.summary()).toThrow(/start/);
  });

  it('plays a whole run: events, a phase that ends, a summary with a log, MET x time', async () => {
    const g = make(manifest);
    const f = fake(3);
    const out = await playOut(g, f);
    expect(g.engine?.phase).toBe('complete');
    expect(out.steps).toBe(Math.ceil(seconds * 60));
    const sum = g.summary();
    expect(sum.score).toBeGreaterThan(0);
    expect(sum.seconds).toBeCloseTo(seconds, 1);
    expect(sum.metSeconds).toBeCloseTo(manifest.met * seconds, 0);
    expect(sum.log.length).toBeGreaterThan(3);
    expect(Number.isFinite(sum.quality ?? 0)).toBe(true);
    expect(sum.log.every((e) => typeof e.kind === 'string' && typeof e.ok === 'boolean')).toBe(true);
  });

  it('shows the score, the time, the streak and the command on the HUD, and only when they change', async () => {
    const g = make(manifest);
    const f = fake(4);
    await playOut(g, f);
    const slots = new Set(f.hud.map(([s]) => s));
    for (const s of ['score', 'timer', 'combo']) expect(slots.has(s), s).toBe(true);
    const scores = f.hud.filter(([s]) => s === 'score').map(([, v]) => v as number);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).not.toBe(scores[i - 1]);
    expect(scores.at(-1)).toBe(g.summary().score);
    const timers = f.hud.filter(([s]) => s === 'timer').map(([, v]) => v as number);
    expect(timers[0]).toBeLessThanOrEqual(seconds);
    expect(timers.at(-1)).toBe(0);
    for (let i = 1; i < timers.length; i++) expect(timers[i]).toBeLessThanOrEqual(timers[i - 1] as number);
    const prompts = f.hud.filter(([s]) => s === 'prompt').map(([, v]) => v);
    expect(prompts.length).toBeGreaterThan(0);
  });

  it('plays the sounds the steps queued, and announces the round to the screen reader but nothing per target', async () => {
    const g = make(manifest);
    const f = fake(5);
    await playOut(g, f);
    expect(f.played.length).toBeGreaterThan(5);
    expect(f.played).toContain('go');
    expect(f.played).toContain('done');
    expect(f.announced.length).toBeLessThanOrEqual(2);
    expect(f.announced[0]).toBe('Round 1 of 1');
  });

  it('goes on playing if a sound throws', async () => {
    const g = make(manifest);
    const f = fake(6);
    (f.ctx.audio as { play: (n: string) => void }).play = () => { throw new Error('no sound card'); };
    await expect(playOut(g, f)).resolves.toBeDefined();
  });

  it('gives a miss a reason on the HUD, in words, within the text budget', async () => {
    const g = make(manifest);
    const f = fake(7);
    await playOut(g, f, { mode: 'idle' });
    const hints = [...new Set(f.hud.filter(([s]) => s === 'hint').map(([, v]) => v as string))].filter(Boolean);
    expect(hints.length).toBeGreaterThan(0);
    for (const h of hints) expect(h.length, h).toBeLessThanOrEqual(40);
    expect(hints.every((h) => !h.includes('reason.') && !h.includes('target.'))).toBe(true);
  });

  it('is the same on every run of the same seed and different for another', async () => {
    const run = async (seed: number): Promise<GameEvent[]> => { const g = make(manifest); return (await playOut(g, fake(seed))).events; };
    const a = await run(11), b = await run(11), c = await run(12);
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  it('snapshot and restore give the same continuation', async () => {
    const f1 = fake(8), f2 = fake(999);
    const a = make(manifest), b = make(manifest);
    await a.init(f1.ctx);
    a.start(START());
    await b.init(f2.ctx);
    const body = new VirtualBody({ clockOffset: 5000 });
    const ch = new Chaser('perfect', 1);
    const frames: InputFrame[] = [];
    let k = 0;
    const stepA = (): ReturnType<typeof a.step> => {
      k++;
      const l = (a.engine as TargetEngine<BaseSpec>).view().lanes[0]!;
      ch.steer(body, seenOf(l));
      const fr = frameOf(k, body.step(k));
      frames.push(fr);
      return a.step(FIXED_DT, fr);
    };
    for (let i = 0; i < 400; i++) stepA();
    const snap = JSON.parse(JSON.stringify(a.snapshot()));
    b.restore(snap);
    const evA: unknown[] = [], evB: unknown[] = [];
    const from = frames.length;
    while ((a.engine as TargetEngine<BaseSpec>).phase === 'running') evA.push(stepA().events);
    for (const fr of frames.slice(from)) evB.push(b.step(FIXED_DT, fr).events);
    expect(evB).toEqual(evA);
    expect(b.summary()).toEqual(a.summary());
    expect(() => b.restore({ v: 1, id: 'other', opts: START(), engine: {} })).toThrow();
    expect(() => b.restore(null)).toThrow();
  });

  it('gives back everything on dispose: the view, the pose listener, the engine', async () => {
    const f = fake(9);
    let disposed = 0, began = 0;
    const g = make(manifest, () => ({ begin() { began++; }, draw() {}, dispose() { disposed++; } }));
    await g.init(f.ctx);
    expect(f.frames.length).toBe(1);
    g.start(START());
    g.restore(g.snapshot());
    expect(began).toBe(2);
    g.dispose();
    expect(disposed).toBe(1);
    expect(f.frames.length).toBe(0);
    expect(g.engine).toBeNull();
    expect(() => g.step(FIXED_DT, frameOf(1, {}))).toThrow();
    g.dispose();
  });

  it('works without a pose service on the context (a keyboard round, a server)', async () => {
    const g = make(manifest);
    await expect(g.init(fake(10, { pose: false }).ctx)).resolves.toBeUndefined();
  });

  it('feeds the view the events of the steps between two frames, once', async () => {
    const seen: ViewFrame['events'][] = [];
    const states: ViewState[] = [];
    const g = make(manifest, () => ({ begin() {}, draw(v, fr) { states.push(v); seen.push(fr.events.slice()); }, dispose() {} }));
    const f = fake(13);
    const out = await playOut(g, f, { render: 3 });
    const total = seen.reduce((n, e) => n + e.length, 0);
    expect(total).toBe(out.events.length);
    expect(states.at(-1)?.phase).toBe('done');
  });

  it('is told the mode, the body profiles and whether it is a keyboard round when a run starts', async () => {
    const begins: unknown[] = [];
    const g = make(manifest, () => ({ begin: (o) => { begins.push(o); }, draw() {}, dispose() {} }));
    await g.init(fake(14).ctx);
    g.start(START({ profile: null }));
    g.start(START({ mode: 'local2', profiles: { 1: profileOf(SHAPE_UPPER, 'upper'), 2: profileOf({ ...SHAPE_UPPER, cx: 0.3 }, 'upper') } }));
    expect(begins).toMatchObject([{ game: id, players: 1, keyboard: true }, { game: id, players: 2, keyboard: false }]);
    expect((begins[1] as { profiles: BodyProfile[] }).profiles.length).toBe(2);
  });
});

describe('the words', () => {
  const langs: Lang[] = ['en', 'tr', 'de', 'es', 'fr'];
  const reasonKeys = Object.keys(TARGET_STRINGS.en).filter((k) => k.startsWith('reason.'));

  it('every language has every key of the English table', () => {
    for (const l of langs) expect(Object.keys(TARGET_STRINGS[l]).sort(), l).toEqual(Object.keys(TARGET_STRINGS.en).sort());
  });

  it('keeps a reason within 40 characters in English and 48 in the other languages, a command within two words', () => {
    for (const l of langs) {
      for (const k of reasonKeys) expect(TARGET_STRINGS[l][k]!.length, `${l} ${k}`).toBeLessThanOrEqual(l === 'en' ? 40 : 48);
    }
    for (const l of langs) for (const k of ['tap_green', 'slip_left', 'slip_right', 'duck', 'rest', 'round']) expect(TARGET_STRINGS[l][k]!.split(' ').length, `${l} ${k}`).toBeLessThanOrEqual(2);
  });

  it('breaks a command word of more than eight letters with a soft hyphen (design/LAYOUT.md section 8)', () => {
    const shy = String.fromCharCode(0xad);
    for (const l of langs) for (const k of ['tap_green', 'slip_left', 'slip_right', 'duck', 'rest', 'round']) {
      for (const word of TARGET_STRINGS[l][k]!.replace(/[{][a-z]+[}]/g, '').split(/[ -]+/)) {
        const letters = word.split(shy).join('');
        if (letters.length > 8) expect(word, `${l} ${k}: ${letters}`).toContain(shy);
      }
    }
    expect(TARGET_STRINGS.es['slip_left']).toContain(shy);
    expect(TARGET_STRINGS.es['slip_left']!.split(shy).join('')).toBe('Esquiva izquierda');
  });

  it('follows the house rules for copy: no dashes, arrows, emoji or exclamation marks', () => {
    for (const l of langs) for (const [k, v] of Object.entries(TARGET_STRINGS[l])) {
      expect(v, `${l} ${k}`).not.toMatch(/[–—―←-⇿!]|->|=>/u);
      expect(v, `${l} ${k}`).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
      expect(v, `${l} ${k}`).toBe(v.trim());
    }
  });

  it('uses the same placeholders in every language', () => {
    const vars = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
    for (const l of langs) for (const k of Object.keys(TARGET_STRINGS.en)) expect(vars(TARGET_STRINGS[l][k]!), `${l} ${k}`).toEqual(vars(TARGET_STRINGS.en[k]!));
  });

  it('shows the player\'s language when the shell has the translations, and English when it has not', async () => {
    const tr = (k: string, v?: Record<string, string | number>): string => {
      const key = k.replace(`${TARGET_NAMESPACE}.`, '');
      const s = TARGET_STRINGS.tr[key];
      return s === undefined ? k : s.replace(/\{(\w+)\}/g, (m, n: string) => String(v?.[n] ?? m));
    };
    const g = createTargetGame(MANIFEST('star-catch', 20), starCatchRules, { rounds: 1 });
    const f = fake(15, { t: tr });
    await playOut(g, f, { mode: 'idle' });
    expect(f.announced[0]).toBe('Tur 1 / 1');
    expect(f.hud.filter(([s]) => s === 'hint').some(([, v]) => v === 'Biraz daha uzan')).toBe(true);
    const plain = createTargetGame(MANIFEST('star-catch', 20), starCatchRules, { rounds: 1 });
    const f2 = fake(15);
    await playOut(plain, f2, { mode: 'idle' });
    expect(f2.announced[0]).toBe('Round 1 of 1');
    expect(english('reason.not_reached')).toBe('Reach a little further');
    expect(english('nope')).toBeNull();
  });

  it('uses the shell\'s own sentence for a reason this package has none for', async () => {
    const g = createTargetGame(MANIFEST('reaction-tag', 20), reactionTagRules, { rounds: 1 });
    const f = fake(16, { t: (k) => (k === 'miss.too_fast' ? 'Çok hızlı' : k) });
    await g.init(f.ctx);
    g.start(START());
    const e = g.engine as TargetEngine<LightSpec>;
    e.lane(1)!.state.hint = { code: 'too_fast', at: 0, until: 9999 };
    g.render(0);
    expect(f.hud.find(([s]) => s === 'hint')?.[1]).toBe('Çok hızlı');
  });
});

describe('the variants', () => {
  it('quiet mode (the shell\'s silent flag) removes the foot lights; seated hands only', async () => {
    const full = profileOf({ ...SHAPE_UPPER, hipY: 0.52, T: 0.2 }, 'full');
    const g = createTargetGame(MANIFEST('reaction-tag', 60, { framing: 'full' }), reactionTagRules, { rounds: 1 });
    await g.init(fake(17, { silent: false }).ctx);
    g.start(START({ difficulty: 'expert', profile: full }));
    const standing = (g.engine as TargetEngine<LightSpec>).plan.map((p) => p.zone);
    expect(standing).toContain('floor');
    const q = createTargetGame(MANIFEST('reaction-tag', 60, { framing: 'full' }), reactionTagRules, { rounds: 1 });
    await q.init(fake(17, { silent: true }).ctx);
    q.start(START({ difficulty: 'expert', profile: full }));
    expect((q.engine as TargetEngine<LightSpec>).plan.some((p) => p.zone === 'floor')).toBe(false);
    const s = createTargetGame(MANIFEST('reaction-tag', 60, { framing: 'full' }), reactionTagRules, { rounds: 1 });
    await s.init(fake(17, { seated: true }).ctx);
    s.start(START({ difficulty: 'expert', profile: full }));
    expect((s.engine as TargetEngine<LightSpec>).plan.every((p) => p.zone === 'hand')).toBe(true);
    expect((s.engine as TargetEngine<LightSpec>).seated).toBe(true);
  });

  it('a seated start asks no low stars and no ducks', async () => {
    const g = createTargetGame(MANIFEST('star-catch', 60), starCatchRules, { rounds: 1 });
    await g.init(fake(18).ctx);
    g.start(START({ difficulty: 'expert', seated: true }));
    expect((g.engine as TargetEngine<StarSpec>).plan.some((p) => p.low)).toBe(false);
    const p = createTargetGame(MANIFEST('pad-work', 90), padWorkRules, { rounds: 1 });
    await p.init(fake(18).ctx);
    p.start(START({ difficulty: 'expert', seated: true }));
    expect((p.engine as TargetEngine<PadSpec>).plan.some((s) => s.need === 'duck')).toBe(false);
  });

  it('a keyboard round (no profile) plays with cursors and shows the same HUD', async () => {
    const g = createTargetGame(MANIFEST('star-catch', 20), starCatchRules, { rounds: 1 });
    const f = fake(19);
    await g.init(f.ctx);
    g.start(START({ profile: null }));
    expect(g.engine?.keyboard).toBe(true);
    for (let k = 1; k <= 300; k++) g.step(FIXED_DT, frameOf(k, k % 100 < 50 ? { 'cursor.R.y': 1 } : {}));
    g.render(0);
    expect(f.hud.some(([s]) => s === 'timer')).toBe(true);
  });

  it('two players: each gets a score and a reason strip on the split HUD, and the summary says who played what', async () => {
    const g = createTargetGame(MANIFEST('star-catch', 30), starCatchRules, { rounds: 1 });
    const f = fake(20, { duoHud: true });
    const mid = profileOf(SHAPE_UPPER, 'upper'), right = profileOf({ ...SHAPE_UPPER, cx: 0.3 }, 'upper');
    await playOut(g, f, { start: { mode: 'local2', profiles: { 1: mid, 2: right } } });
    const sum = g.summary();
    expect(sum.players?.[1]?.score).toBeGreaterThan(0);
    expect(sum.players?.[2]?.score).toBeGreaterThan(0);
    expect(f.duo.some(([p, s]) => p === 1 && s === 'score')).toBe(true);
    expect(f.duo.some(([p, s]) => p === 2 && s === 'score')).toBe(true);
    expect(f.hud.some(([s]) => s === 'score')).toBe(false);
    expect(f.duo.filter(([p, s]) => p === 1 && s === 'score').at(-1)?.[2]).toBe(sum.players?.[1]?.score);
  });

  it('two players on a HUD without split slots: the better score is shown', async () => {
    const g = createTargetGame(MANIFEST('star-catch', 20), starCatchRules, { rounds: 1 });
    const f = fake(21);
    await playOut(g, f, { start: { mode: 'local2', profiles: { 1: profileOf(SHAPE_UPPER, 'upper'), 2: profileOf(SHAPE_UPPER, 'upper') } } });
    const sum = g.summary();
    expect(f.hud.filter(([s]) => s === 'score').at(-1)?.[1]).toBe(sum.score);
  });

  it('knows the levels the shell and the runner use', () => {
    expect(levelOf('normal')).toBe('normal');
    expect(levelOf('medium')).toBe('normal');
    expect(levelOf('insane')).toBe('expert');
    expect(levelOf('easy')).toBe('easy');
    expect(levelOf('whatever')).toBe('normal');
  });
});

describe('the summary the results screen reads', () => {
  it('counts what there is to clear (constellations, combinations) and leaves it out for a game with nothing to clear', () => {
    const run = (rules: Rules<never>): ReturnType<TargetEngine<never>['summary']> => {
      const r = setup(rules as never, { duration: 30, rounds: 1, level: 'normal', seed: 3 });
      play(r);
      return r.engine.summary();
    };
    expect(run(starCatchRules as never).cleared, 'star catch').toBeGreaterThan(0);
    expect(run(padWorkRules as never).cleared, 'pad work').toBeGreaterThanOrEqual(0);
    const tag = run(reactionTagRules as never);
    expect('cleared' in tag, 'reaction tag has nothing to clear').toBe(false);
    expect(tag.hits).toBeGreaterThan(0);
    expect(tag.quality, 'hits over every light that was not left alone').toBeGreaterThan(0.5);
  });

  it('gives each player of a two-player round their own numbers, with cleared only where it means something', () => {
    const r = setup(reactionTagRules as never, { duration: 20, rounds: 1, level: 'easy', seed: 4, bots: ['perfect', 'perfect'] });
    play(r);
    const sum = r.engine.summary();
    expect(Object.keys(sum.players ?? {})).toEqual(['1', '2']);
    for (const slot of [1, 2] as const) {
      expect(sum.players![slot]!.hits).toBeGreaterThan(0);
      expect('cleared' in sum.players![slot]!).toBe(false);
    }
  });
});
