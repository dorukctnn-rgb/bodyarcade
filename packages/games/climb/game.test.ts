// Summit Climb on the Game contract: what the movement channels and events turn into, the HUD, the sounds, the seated and the
// quiet variants, snapshot and restore, the picture on a recording canvas, the manifest, and a whole run through the Session
// with the keyboard.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import type { AudioApi, GameEvent, InputEvent } from '../../core/types/index.ts';
import { FIXED_DT } from '../../core/types/index.ts';
import { createSession } from '../../core/loop/session.ts';
import { DETECTORS } from '../../core/moves/index.ts';
import { copyProblems } from '../../web/catalogue/copy.ts';
import { evt, frame, testContext, type TestCtx } from '../kit-g1/testing/context.ts';
import { budgetProblems } from '../kit-g1/testing/strings.ts';
import { testScene } from '../kit-g1/testing/scene.ts';
import { BREAKPOINTS, type PipPlacement } from '../../core/ui/layout.ts';
import { screenProblems } from '../kit-g1/testing/screens.ts';
import summitClimb, { manifest, STRINGS } from '../summit-climb/index.ts';
import { createClimbGame, HINT_SEC, KEY_LIFT, MET, readIn, type ClimbGame } from './game.ts';
import { BREATH_SEC, LEVELS, pendingRock, POINTS, WARMUP, type ClimbIn, type Section } from './sim.ts';
import { climbBot, type BotKind } from './testing/bot.ts';

const START = (o: Partial<Parameters<ClimbGame['start']>[0]> = {}): Parameters<ClimbGame['start']>[0] => ({ seed: 1, difficulty: 'normal', seated: false, mode: 'solo', profile: null, ...o });

/** What the movement library would deliver for a bot's body at step k. */
function inputOf(k: number, b: ClimbIn): { channels: Record<string, number>; events: InputEvent[] } {
  const events: InputEvent[] = b.pulls.map((p) => evt('pull', 'rep', k, { side: p.side as 'L' | 'R', q: { range: p.amp }, value: 1 }));
  for (const st of b.steps) events.push(evt('kneeLift', 'rep', k, { side: st.side as 'L' | 'R', q: { range: st.k } }));
  const channels: Record<string, number> = { lane: b.lane };
  (['L', 'R'] as const).forEach((side, i) => {
    const h = b.hands[i]!;
    if (h.have) { channels[`reach.${side}`] = h.reach; channels[`pull.${side}`] = h.prog; channels[`grab.${side}`] = h.grab ? 1 : 0; }
  });
  return { channels, events };
}

async function ready(o: { start?: Parameters<ClimbGame['start']>[0]; ctx?: Parameters<typeof testContext>[0]; scene?: boolean; game?: Parameters<typeof createClimbGame>[1] } = {}): Promise<{ game: ClimbGame; t: TestCtx }> {
  const scene = o.scene ? testScene(390, 844) : null;
  const t = testContext({ ...(o.ctx ?? {}), ...(scene ? { scene2d: scene.kit } : {}) });
  const game = createClimbGame(manifest, { ...(scene ? {} : { view: false }), ...(o.game ?? {}) });
  await game.init(t.ctx);
  game.start(o.start ?? START());
  return { game, t };
}

/** Plays with a bot through Game.step; returns every game event. */
function playGame(game: ClimbGame, kind: BotKind, o: { steps?: number; from?: number; botSeed?: number; renderEvery?: number } = {}): { events: GameEvent[]; k: number; phase: string } {
  const bot = climbBot(kind, o.botSeed ?? 1);
  const events: GameEvent[] = [];
  let k = o.from ?? 0;
  let phase = 'running';
  const max = o.steps ?? 60 * 700;
  while (phase === 'running' && k < (o.from ?? 0) + max) {
    const s = game.state!;
    const x = inputOf(++k, bot.next(s, FIXED_DT));
    const r = game.step(FIXED_DT, frame(k, x.channels, x.events));
    events.push(...r.events);
    phase = r.phase;
    if (o.renderEvery && k % o.renderEvery === 0) game.render(0.5);
  }
  return { events, k, phase };
}

const types = (events: readonly GameEvent[]): string[] => events.map((e) => (e as { type?: string }).type ?? '');

/** Runs the warm-up with three pulls and the countdown, so that the climb has begun; returns the frame counter. */
function toClimb(game: ClimbGame, from = 0): number {
  let k = from;
  for (let i = 0; i < WARMUP.pulls; i++) { game.step(FIXED_DT, frame(++k, {}, [evt('pull', 'rep', k, { side: i % 2 ? 'R' : 'L', q: { range: 0.85 }, value: 1 })])); for (let j = 0; j < 20; j++) game.step(FIXED_DT, frame(++k)); }
  while (game.state!.phase !== 'climb' && k < from + 60 * 20) game.step(FIXED_DT, frame(++k));
  return k;
}

describe('input to the simulation', () => {
  const lane = (channels: Record<string, number>, events: InputEvent[] = []) => ({ tracking: { ok: true as const }, channels, events, present: true });
  const standing = { seated: false, quiet: false };

  it('a pull rep is a pull with its side, its length and its value, and says when the shoulders went up', () => {
    const l = readIn(lane({}, [evt('pull', 'rep', 1, { side: 'R', q: { range: 0.9 }, value: 0.5 }), evt('pull', 'rep', 1, { side: 'L', q: { range: 0.8 }, value: 1, warn: ['shrug'] })]), standing);
    expect(l.pulls).toEqual([{ side: 'R', amp: 0.45, shrug: false }, { side: 'L', amp: 0.8, shrug: true }]);
  });

  it('a key or a tap has no side and no length: it is a standard pull and the hands take turns by themselves', () => {
    const l = readIn(lane({}, [evt('pull', 'rep', 1)]), standing);
    expect(l.pulls).toEqual([{ side: '', amp: 0, shrug: false }]);
  });

  it('a knee lift rep is a step up a ledge (a tap is a good one); the arms-only variants leave it out', () => {
    const e = [evt('kneeLift', 'rep', 1, { side: 'L', q: { range: 0.7 } }), evt('kneeLift', 'rep', 1)];
    expect(readIn(lane({}, e), standing).steps).toEqual([{ k: 0.7, side: 'L' }, { k: KEY_LIFT, side: '' }]);
    expect(readIn(lane({}, e), { seated: true, quiet: false }).steps).toEqual([]);
    expect(readIn(lane({}, e), { seated: false, quiet: true }).steps).toEqual([]);
  });

  it('events of other movements and the other kinds of event are not pulls and not steps', () => {
    const l = readIn(lane({}, [evt('squat', 'rep', 1), evt('pull', 'holdStart', 1), evt('kneeLift', 'hit', 1), evt('jump', 'rep', 1)]), standing);
    expect(l.pulls).toEqual([]);
    expect(l.steps).toEqual([]);
  });

  it('reads the column from the lean channel and the hands from their channels; without them it knows nothing of the hands', () => {
    expect(readIn(lane({ lane: -1 }), standing).lane).toBe(-1);
    expect(readIn(lane({ lane: 1 }), standing).lane).toBe(1);
    expect(readIn(lane({ lane: 0.2 }), standing).lane).toBe(0);
    expect(readIn(lane({}), standing).lane).toBe(0);
    const h = readIn(lane({ 'reach.L': 0.4, 'reach.R': -0.6, 'pull.L': 0.3, 'pull.R': 0, 'grab.L': 1, 'grab.R': 0 }), standing).hands;
    expect(h[0]).toEqual({ have: true, reach: 0.4, prog: 0.3, grab: true });
    expect(h[1]).toEqual({ have: true, reach: -0.6, prog: 0, grab: false });
    expect(readIn(lane({}), standing).hands[0].have).toBe(false);
  });
});

describe('Summit Climb through Game.step', () => {
  it('a perfect climber climbs a whole round: the same seed gives the same events, another seed another wall', async () => {
    const a = await ready({ start: START({ seed: 5 }), ctx: { seed: 5 } });
    const b = await ready({ start: START({ seed: 5 }), ctx: { seed: 5 } });
    const c = await ready({ start: START({ seed: 6 }), ctx: { seed: 6 } });
    const ra = playGame(a.game, 'perfect');
    const rb = playGame(b.game, 'perfect');
    playGame(c.game, 'perfect');
    expect(ra.phase).toBe('complete');
    expect(types(ra.events)).toEqual(types(rb.events));
    expect(JSON.stringify(a.game.snapshot())).toBe(JSON.stringify(b.game.snapshot()));
    expect(a.game.state!.course).not.toEqual(c.game.state!.course);
  });

  it('the full round on easy: warm-up, three climbs, two rests, then complete; the summary adds up', async () => {
    const { game } = await ready({ start: START({ difficulty: 'easy' }) });
    const r = playGame(game, 'perfect');
    expect(r.phase).toBe('complete');
    const ev = types(r.events);
    expect(ev.filter((x) => x === 'go')).toHaveLength(3);
    expect(ev.filter((x) => x === 'rest')).toHaveLength(2);
    expect(ev.filter((x) => x === 'finish')).toHaveLength(3);
    expect(ev.filter((x) => x === 'summit')).toHaveLength(3);
    expect(ev.at(-1)).toBe('complete');
    const sum = game.summary();
    const points = new Set(['pull', 'step', 'dodge', 'ledge', 'crux', 'finish']);
    expect(sum.score).toBe(sum.log.filter((e) => points.has(e.kind)).reduce((n, e) => n + (e.v ?? 0), 0));
    expect(sum.log.filter((e) => e.kind === 'finish')).toHaveLength(3);
    expect(sum.log.filter((e) => e.kind === 'height').map((e) => e.v)).toEqual([30, 30, 30]);
    const res = game.state!.c.results;
    expect(sum.reps).toBe(res.reduce((n, x) => n + x.pulls + x.steps, 0));
    expect(sum.cleared).toBe(res.reduce((n, x) => n + x.dodged + x.ledges + x.crux, 0));
    expect(sum.hits).toBe(0);
    expect(sum.quality ?? 0).toBeGreaterThan(0.9);
    expect(sum.seconds).toBeGreaterThan(80);
    // The calories follow the seconds spent on the wall at the standing rate.
    expect(sum.metSeconds).toBeCloseTo(MET.standing * game.state!.c.ran, 0);
  });

  it('a summary taken in the middle of a climb counts what has been done so far', async () => {
    const { game } = await ready({ start: START({ difficulty: 'normal' }) });
    playGame(game, 'good', { steps: 60 * 30 });
    const sum = game.summary();
    expect(game.state!.phase).toBe('climb');
    expect(sum.reps).toBeGreaterThan(5);
    expect(sum.score).toBe(game.state!.c.score);
  });

  it('hanging there loses the climbs: two called off in a row end the run, and the log says dnf', async () => {
    const { game } = await ready({ start: START({ difficulty: 'easy' }) });
    const r = playGame(game, 'idle');
    expect(r.phase).toBe('over');
    const sum = game.summary();
    expect(sum.reps).toBe(0);
    expect(sum.score).toBeLessThan(30);
    expect(sum.log.filter((e) => e.kind === 'dnf')).toHaveLength(2);
    expect(sum.metSeconds).toBeGreaterThanOrEqual(0);
  });

  it('the keys and taps climb too: a pull without a side or a length is a standard one, the hands take turns', async () => {
    const { game } = await ready({ start: START({ difficulty: 'easy' }), game: { summit: 6, sets: 1 } });
    let k = toClimb(game);
    (game.state as unknown as { sections: Section[]; rocks: unknown[] }).sections = [];
    (game.state as unknown as { rocks: unknown[] }).rocks = [];
    const sides: string[] = [];
    for (let i = 0; i < 12 && game.state!.phase === 'climb'; i++) {
      const r = game.step(FIXED_DT, frame(++k, {}, [evt('pull', 'rep', k)]));
      sides.push(...r.events.filter((e) => (e as { type?: string }).type === 'pull').map((e) => (e as unknown as { side: string }).side));
      for (let j = 0; j < 30; j++) game.step(FIXED_DT, frame(++k));
    }
    expect(sides.length).toBeGreaterThan(4);
    sides.forEach((s, i) => expect(s).toBe(i % 2 ? 'R' : 'L'));
    expect(game.state!.c.results[0]!.medal).toBe('gold');
  });

  it('restore(snapshot()) continues identically, in a new game instance too', async () => {
    const a = await ready({ start: START({ difficulty: 'normal', seed: 3 }), ctx: { seed: 3 } });
    const first = playGame(a.game, 'good', { steps: 60 * 40 });
    expect(first.phase).toBe('running');
    const snap = JSON.parse(JSON.stringify(a.game.snapshot()));
    const b = await ready({ start: START({ difficulty: 'normal', seed: 99 }), ctx: { seed: 99 } });
    b.game.restore(snap);
    const botA = climbBot('good', 7), botB = climbBot('good', 7);
    const evA: string[] = [], evB: string[] = [];
    let ka = first.k, kb = first.k;
    for (let i = 0; i < 60 * 60; i++) {
      const ia = inputOf(++ka, botA.next(a.game.state!, FIXED_DT));
      const ib = inputOf(++kb, botB.next(b.game.state!, FIXED_DT));
      evA.push(JSON.stringify(a.game.step(FIXED_DT, frame(ka, ia.channels, ia.events)).events));
      evB.push(JSON.stringify(b.game.step(FIXED_DT, frame(kb, ib.channels, ib.events)).events));
    }
    expect(evB).toEqual(evA);
    expect(JSON.stringify(b.game.snapshot())).toBe(JSON.stringify(a.game.snapshot()));
    expect(b.game.summary()).toEqual(a.game.summary());
  });

  it('refuses a snapshot of something else', async () => {
    const { game } = await ready();
    expect(() => game.restore({ v: 2 })).toThrow(/snapshot/);
    expect(() => game.restore(null)).toThrow(/snapshot/);
  });

  it('needs init() before start() and start() before step()', async () => {
    const game = createClimbGame(manifest, { view: false });
    expect(() => game.start(START())).toThrow(/init/);
    await game.init(testContext().ctx);
    expect(() => game.step(FIXED_DT, frame(1))).toThrow(/start/);
    expect(() => game.summary()).toThrow(/start/);
  });

  it('is pure: no clock, no random, no sine, no DOM in the simulation, the game and the bots', () => {
    for (const f of ['sim.ts', 'game.ts', 'testing/bot.ts']) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(src, f).not.toMatch(/Math\.random|performance\.now|Date\.now|document\.|window\.|Math\.sin|Math\.cos|setTimeout|requestAnimationFrame/);
    }
  });
});

describe('the HUD and the sounds', () => {
  it('sets a plate only when its value changes', async () => {
    const { game, t } = await ready({ start: START({ difficulty: 'easy' }) });
    const n0 = t.hud.length;
    game.render(0);
    game.render(0);
    game.render(0.5);
    expect(t.hud.length).toBe(n0);
  });

  it('asks to reach up, and to pull down when a hand has hold; then "Ready", the announcements, and the climb with the seconds left', async () => {
    const { game, t } = await ready({ start: START({ difficulty: 'normal' }) });
    game.render(0);
    expect(t.lastHud('prompt')).toEqual({ icon: 'reach', text: 'Reach up' });
    game.step(FIXED_DT, frame(1, { 'reach.L': 0.5, 'reach.R': -0.8, 'pull.L': 0, 'pull.R': 0, 'grab.L': 1, 'grab.R': 0 }));
    game.render(0);
    expect(t.lastHud('prompt')).toEqual({ icon: 'pull', text: 'Pull down' });
    let k = 1;
    for (let i = 0; i < WARMUP.pulls; i++) { game.step(FIXED_DT, frame(++k, {}, [evt('pull', 'rep', k, { side: i % 2 ? 'R' : 'L', q: { range: 0.85 }, value: 1 })])); for (let j = 0; j < 20; j++) game.step(FIXED_DT, frame(++k)); }
    game.render(0);
    expect(t.lastHud('prompt')).toBe('Ready');
    expect(t.announced.some((a) => /Climb 1 of 3, the top is 42 metres up/.test(a))).toBe(true);
    while (game.state!.phase !== 'climb') game.step(FIXED_DT, frame(++k));
    game.render(0);
    expect(t.announced).toContain('Climb');
    expect(t.lastHud('timer')).toBe(LEVELS.normal.setSec);
    for (let i = 0; i < 60 * 10; i++) game.step(FIXED_DT, frame(++k));
    game.render(0);
    expect(t.lastHud('timer')).toBe(LEVELS.normal.setSec - 10);
    expect(t.lastHud('score')).toBe(0);
  });

  it('says "Step up" with the knee on a ledge, "Breathe" at the breather, and "Fast hands" in the hard part', async () => {
    const { game, t } = await ready({ start: START({ difficulty: 'normal' }) });
    let k = toClimb(game);
    const s = game.state as unknown as { sections: Section[]; rocks: unknown[]; c: { h: number } };
    s.rocks = [];
    s.sections = [{ kind: 'ledge', y0: 0.5, len: 2, steps: 4, sec: 0 }, { kind: 'crux', y0: 3.5, len: 3, steps: 0, sec: 8 }, { kind: 'rest', y0: 8, len: 0, steps: 0, sec: 0 }];
    const pullOnce = (): void => { game.step(FIXED_DT, frame(++k, {}, [evt('pull', 'rep', k, { side: game.state!.c.lastSide === 'L' ? 'R' : 'L', q: { range: 0.85 }, value: 1 })])); for (let j = 0; j < 30; j++) game.step(FIXED_DT, frame(++k)); };
    pullOnce();
    game.render(0);
    expect(game.state!.c.on).toBe('ledge');
    expect(t.lastHud('prompt')).toEqual({ icon: 'highKnee', text: 'Step up' });
    expect(t.announced).toContain('Ledge, step up with your knees');
    for (let i = 0; i < 4; i++) { game.step(FIXED_DT, frame(++k, {}, [evt('kneeLift', 'rep', k, { side: 'L', q: { range: 0.8 } })])); for (let j = 0; j < 20; j++) game.step(FIXED_DT, frame(++k)); }
    pullOnce();
    pullOnce();
    pullOnce();
    pullOnce();
    game.render(0);
    expect(game.state!.c.cruxOn).toBe(true);
    expect(t.lastHud('prompt')).toEqual({ icon: 'pull', text: 'Fast hands' });
    expect(t.announced).toContain('Hard part, climb fast');
    for (let i = 0; i < 8 && game.state!.c.on !== 'rest'; i++) pullOnce();
    game.render(0);
    expect(game.state!.c.on).toBe('rest');
    const prompt = t.lastHud('prompt') as { icon: string; text: string; progress: number };
    expect(prompt.text).toBe('Breathe');
    expect(prompt.progress).toBeGreaterThanOrEqual(0);
    expect(prompt.progress).toBeLessThan(1);
    expect(t.announced).toContain('Breather, take a breath');
    for (let i = 0; i < 60 * BREATH_SEC; i++) game.step(FIXED_DT, frame(++k));
    game.render(0);
    expect((t.lastHud('prompt') as { text: string }).text).not.toBe('Breathe');
  });

  it('names the way out of a rock: lean left or right when one side is open, aside when both are', async () => {
    const lean = async (closed: [boolean, boolean, boolean], lane: number): Promise<string> => {
      const { game, t } = await ready({ start: START({ difficulty: 'normal' }) });
      const k = toClimb(game);
      const s = game.state as unknown as { sections: Section[]; rocks: { t: number; closed: [boolean, boolean, boolean] }[]; setT: number };
      s.sections = [];
      s.rocks = [{ t: s.setT + 1.2, closed }];
      game.step(FIXED_DT, frame(k + 1, { lane }));
      game.render(0);
      const p = t.lastHud('prompt');
      return typeof p === 'string' ? p : (p as { text: string }).text;
    };
    expect(await lean([false, true, true], 0)).toBe('Lean left');
    expect(await lean([true, true, false], 0)).toBe('Lean right');
    expect(await lean([false, true, false], 0)).toBe('Lean aside');
    // Already out of the way: the usual command.
    expect(await lean([true, false, false], 0)).toBe('Reach up');
    expect(await lean([false, true, false], -1)).toBe('Reach up');
  });

  it('plays a sound for a pull, a dodge, a knock, a ledge, a hard part and the top, once each', async () => {
    const { game, t } = await ready({ start: START({ difficulty: 'normal' }), game: { sets: 1 } });
    playGame(game, 'perfect', { renderEvery: 3 });
    game.render(0);
    expect(t.sounds).toContain('rep');
    expect(t.sounds).toContain('tick');
    expect(t.sounds).toContain('go');
    expect(t.sounds).toContain('warn');
    expect(t.sounds).toContain('good');
    expect(t.sounds.filter((x) => x === 'coin')).toHaveLength(2);
    expect(t.sounds.filter((x) => x === 'perfect')).toHaveLength(1);
    expect(t.sounds.filter((x) => x === 'pass').length).toBeGreaterThanOrEqual(8);
    expect(t.sounds.filter((x) => x === 'win').length).toBe(3);
    const n = t.sounds.length;
    game.render(0);
    expect(t.sounds.length).toBe(n);
    const hit = await ready({ start: START({ difficulty: 'normal' }), game: { sets: 1 } });
    playGame(hit.game, 'sloppy', { renderEvery: 3 });
    hit.game.render(0);
    expect(hit.t.sounds).toContain('hit');
  });

  it('says the reason of a miss in the strip, from the shell strings when it has them and in English when not', async () => {
    const english = await ready({ start: START({ difficulty: 'easy' }) });
    playGame(english.game, 'short', { steps: 60 * 40, renderEvery: 5 });
    const said = english.t.hud.filter(([slot, v]) => slot === 'hint' && v !== '').map(([, v]) => v);
    expect(said).toContain('Reach higher before you pull');
    const turkish = await ready({ start: START({ difficulty: 'easy' }), ctx: { t: (k) => (k === 'miss.grab_higher' ? 'Daha yükseğe uzan' : k) } });
    playGame(turkish.game, 'short', { steps: 60 * 40, renderEvery: 5 });
    expect(turkish.t.hud.filter(([slot, v]) => slot === 'hint' && v !== '').map(([, v]) => v)).toContain('Daha yükseğe uzan');
    expect(HINT_SEC).toBeGreaterThan(2);
  });

  it('a sound that fails never fails a frame', async () => {
    const t = testContext();
    (t.ctx.audio as AudioApi).play = () => { throw new Error('no audio device'); };
    const game = createClimbGame(manifest, { view: false });
    await game.init(t.ctx);
    game.start(START({ difficulty: 'easy' }));
    playGame(game, 'perfect', { steps: 60 * 20 });
    expect(() => game.render(0)).not.toThrow();
  });
});

describe('the seated and the quiet variants', () => {
  it('seated: the arms climb a lower wall without ledges, a knee does nothing, and the calories are the arms-only ones', async () => {
    const seated = await ready({ start: START({ seated: true, difficulty: 'normal' }), ctx: { seated: true }, game: { sets: 2 } });
    expect(seated.game.state!.seated).toBe(true);
    expect(seated.game.state!.sections.some((x) => x.kind === 'ledge')).toBe(false);
    expect(seated.game.state!.summit).toBeLessThan(LEVELS.normal.summit);
    const r = playGame(seated.game, 'perfect');
    expect(r.phase).toBe('complete');
    const sum = seated.game.summary();
    expect(seated.game.state!.c.results.map((x) => x.medal)).toEqual(['gold', 'gold']);
    expect(sum.metSeconds).toBeCloseTo(MET.seated * seated.game.state!.c.ran, 0);
    // A knee lifted on the wall is nothing, and the command never asks for one.
    expect(seated.t.hud.some(([slot, v]) => slot === 'prompt' && (v as { text?: string })?.text === 'Step up')).toBe(false);
    const k = toClimb(seated.game);
    seated.game.step(FIXED_DT, frame(k + 1, {}, [evt('kneeLift', 'rep', k + 1, { side: 'L', q: { range: 0.9 } })]));
    expect(seated.game.state!.c.steps).toBe(0);
  });

  it('quiet: no ledge to step up either, a lower wall, the same climb with the arms', async () => {
    const quiet = await ready({ start: START({ difficulty: 'normal' }), ctx: { silent: true }, game: { sets: 2 } });
    expect(quiet.game.state!.quiet).toBe(true);
    expect(quiet.game.state!.sections.some((x) => x.kind === 'ledge')).toBe(false);
    const r = playGame(quiet.game, 'perfect');
    expect(r.phase).toBe('complete');
    expect(quiet.game.state!.c.results.map((x) => x.medal)).toEqual(['gold', 'gold']);
    expect(quiet.game.summary().metSeconds).toBeCloseTo(MET.seated * quiet.game.state!.c.ran, 0);
  });

  it('a standing climber has the ledges and the higher wall', async () => {
    const { game } = await ready({ start: START({ difficulty: 'normal' }) });
    expect(game.state!.sections.filter((x) => x.kind === 'ledge')).toHaveLength(LEVELS.normal.ledges);
    expect(game.state!.summit).toBe(LEVELS.normal.summit);
  });
});

describe('the picture', () => {
  it('draws a frame on a recording canvas: wall, climber, rail, self view; and the climber is inside the play area', async () => {
    const { game, t } = await ready({ scene: true, start: START({ difficulty: 'easy' }) });
    const scene = (t.ctx.scene2d as unknown as { rects: { play: { x: number; y: number; w: number; h: number }; pip: unknown } });
    const bot = climbBot('perfect', 1);
    let k = 0;
    for (let i = 0; i < 60 * 24; i++) { const x = inputOf(++k, bot.next(game.state!, FIXED_DT)); game.step(FIXED_DT, frame(k, x.channels, x.events)); if (i % 3 === 0) game.render(0.5); }
    const at = game.view!.climberAt()!;
    const play = scene.rects.play;
    expect(at.x).toBeGreaterThan(play.x);
    expect(at.x).toBeLessThan(play.x + play.w);
    expect(at.y).toBeGreaterThan(play.y);
    expect(at.y).toBeLessThan(play.y + play.h);
    const wall = game.view!.wallAt()!;
    expect(wall.x).toBeGreaterThanOrEqual(0);
    expect(wall.x + wall.colW * 3).toBeLessThanOrEqual(play.x + play.w + 1);
    expect(scene.rects.pip).not.toBeNull();
  });

  it('shows the warm-up text and the get-ready panel as text on the canvas', async () => {
    const { game, t } = await ready({ scene: true, start: START({ difficulty: 'easy' }) });
    const sc = (t.ctx.scene2d as unknown as { ctx: { texts: { text: string }[] } });
    game.render(0);
    const seen = (): string[] => sc.ctx.texts.map((x) => x.text);
    expect(seen().some((x) => /Warm-up/.test(x))).toBe(true);
    toClimbWarm(game);
    game.render(0);
    expect(seen().some((x) => /Climb 1 of 3/.test(x))).toBe(true);
  });

  it('draws the height while climbing and moves the climber into the column he leans to', async () => {
    const { game, t } = await ready({ scene: true, start: START({ difficulty: 'easy' }) });
    const sc = (t.ctx.scene2d as unknown as { ctx: { texts: { text: string }[] } });
    let k = toClimb(game);
    game.render(0.5);
    const x0 = game.view!.climberAt()!.x;
    for (let i = 0; i < 40; i++) { game.step(FIXED_DT, frame(++k, { lane: 1 })); game.render(0.5); }
    expect(game.view!.climberAt()!.x).toBeGreaterThan(x0 + 20);
    expect(sc.ctx.texts.some((x) => /^\d+ m$/.test(x.text))).toBe(true);
  });

  it('disposes everything it made', async () => {
    const { game, t } = await ready({ scene: true });
    game.render(0);
    expect(t.subscribers()).toBe(1);
    game.dispose();
    expect(t.subscribers()).toBe(0);
    expect(game.view).toBeNull();
  });
});

describe('the view on the ten screens and in every corner of the self view', () => {
  const CORNERS: PipPlacement[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];

  /** Climbs a whole short round with a bot on a screen and collects what is wrong with every frame drawn. */
  async function sweep(w: number, h: number, corner: PipPlacement, kind: BotKind, o: { seated?: boolean; quiet?: boolean } = {}): Promise<{ problems: string[]; frames: number; phases: Set<string> }> {
    const scene = testScene(w, h, { corner });
    const t = testContext({ scene2d: scene.kit, seated: o.seated ?? false, silent: o.quiet ?? false });
    const game = createClimbGame(manifest, { sets: 2, summit: 16, setSec: 24, restSec: 3 });
    await game.init(t.ctx);
    game.start(START({ difficulty: 'hard', seated: o.seated ?? false }));
    const bot = climbBot(kind, 2);
    const problems = new Set<string>();
    const phases = new Set<string>();
    let frames = 0;
    for (let k = 1; k < 60 * 120 && game.state!.phase !== 'complete' && game.state!.phase !== 'over'; k++) {
      const x = inputOf(k, bot.next(game.state!, FIXED_DT));
      game.step(FIXED_DT, frame(k, x.channels, x.events));
      if (k % 20 === 0) {
        scene.ctx.texts.length = 0;
        game.render(0.5);
        frames++;
        phases.add(game.state!.phase);
        for (const p of screenProblems(scene, game.view!.climberAt(), `${w}x${h} ${corner} ${game.state!.phase}`)) problems.add(p);
      }
    }
    return { problems: [...problems], frames, phases };
  }

  it('on every one of the ten screens nothing runs off the screen and the climber is clear of the plates and the self view', async () => {
    for (const b of BREAKPOINTS) {
      const r = await sweep(b.w, b.h, 'bottom-right', 'good');
      expect(r.problems, b.label).toEqual([]);
      expect(r.frames, b.label).toBeGreaterThan(40);
      for (const ph of ['warmup', 'ready', 'climb', 'finish', 'rest']) expect(r.phases.has(ph), `${b.label} ${ph}`).toBe(true);
    }
  });

  it('in every corner of the self view, on a phone, a phone on its side and a laptop', async () => {
    for (const [w, h] of [[390, 844], [844, 390], [1280, 800]] as const) {
      for (const corner of CORNERS) {
        const r = await sweep(w, h, corner, 'sloppy');
        expect(r.problems, `${w}x${h} ${corner}`).toEqual([]);
      }
    }
  });

  it('the seated and the quiet climbers too, on a phone and a laptop', async () => {
    for (const [w, h] of [[390, 844], [1280, 800]] as const) {
      for (const v of [{ seated: true }, { quiet: true }]) {
        const r = await sweep(w, h, 'bottom-right', 'perfect', v);
        expect(r.problems, `${w}x${h} ${JSON.stringify(v)}`).toEqual([]);
      }
    }
  });
});

/** Brings the game to the get-ready panel (three warm-up pulls). */
function toClimbWarm(game: ClimbGame): void {
  let k = 0;
  for (let i = 0; i < WARMUP.pulls; i++) { game.step(FIXED_DT, frame(++k, {}, [evt('pull', 'rep', k, { side: i % 2 ? 'R' : 'L', q: { range: 0.85 }, value: 1 })])); for (let j = 0; j < 10; j++) game.step(FIXED_DT, frame(++k)); }
}

describe('the manifest and the strings', () => {
  it('is valid against the catalogue schema and lists only what works', () => {
    const schema = JSON.parse(readFileSync(new URL('../../web/catalogue/manifest.schema.json', import.meta.url), 'utf8'));
    const validate = new Ajv2020({ allErrors: true }).compile(schema);
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    expect(manifest.id).toBe('summit-climb');
    expect(manifest.modes).toEqual(['solo']);
    expect(manifest.free).toBe(true);
    expect(manifest.seated && manifest.silentSafe && manifest.lowImpact).toBe(true);
    for (const d of manifest.detectors) expect(DETECTORS[d.id], d.id).toBeTypeOf('function');
    expect(manifest.detectors.map((d) => d.id)).toEqual(['pull', 'kneeLift', 'lean']);
    // Every lift counts on a ledge: the knees do not take turns.
    expect(manifest.detectors[1]!.opts).toMatchObject({ alternate: 0 });
  });

  it('the module has the keys and the swipes, and creates a game', () => {
    expect(summitClimb.manifest).toBe(manifest);
    expect(summitClimb.controls?.keys?.[' ']).toEqual({ event: 'pull' });
    expect(summitClimb.controls?.keys?.ArrowDown).toEqual({ event: 'kneeLift' });
    expect(summitClimb.controls?.keys?.ArrowLeft).toEqual({ channel: 'lane', value: -1 });
    expect(summitClimb.controls?.keys?.ArrowRight).toEqual({ channel: 'lane', value: 1 });
    expect(summitClimb.controls?.touch?.tap).toEqual({ event: 'pull' });
    expect(summitClimb.controls?.touch?.down).toEqual({ event: 'kneeLift' });
    expect(summitClimb.controls?.touch?.left).toMatchObject({ channel: 'lane', value: -1, holdMs: 1800 });
    expect(summitClimb.controls?.touch?.right).toMatchObject({ channel: 'lane', value: 1, holdMs: 1800 });
    expect(summitClimb.create().manifest).toBe(manifest);
  });

  it('every string follows the house rules, in every language, and every language has every key the English has', () => {
    for (const [lang, table] of Object.entries(STRINGS)) {
      for (const [k, v] of Object.entries(table ?? {})) expect(copyProblems(v), `${lang} ${k}`).toEqual([]);
    }
    const en = Object.keys(STRINGS.en ?? {});
    expect(en.length).toBeGreaterThan(50);
    for (const lang of ['tr', 'de', 'es', 'fr'] as const) {
      for (const k of en) expect(STRINGS[lang]?.[k], `${lang} ${k}`).toBeTruthy();
    }
    // The words in braces are the same in every language.
    const slots = (v: string): string => (v.match(/\{[a-z]+\}/g) ?? []).sort().join();
    for (const lang of ['tr', 'de', 'es', 'fr'] as const) for (const k of en) expect(slots(STRINGS[lang]?.[k] ?? ''), `${lang} ${k}`).toBe(slots(STRINGS.en?.[k] ?? ''));
  });

  it('the commands and the reasons keep to the text budgets of design/LAYOUT.md section 8', () => {
    expect(budgetProblems(STRINGS, { commands: /^(cmd\.|ready\.title$|rest\.title$)/, reasons: /^miss\./ })).toEqual([]);
  });

  it('the duration of the manifest is the length of a normal round: warm-up, three climbs and two rests', () => {
    const n = LEVELS.normal;
    expect(manifest.durationSec).toBeGreaterThanOrEqual(3 * 60 + 2 * n.restSec + 30);
    expect(manifest.durationSec).toBeLessThanOrEqual(3 * n.setSec + 2 * n.restSec + 3 * 6 + 30);
  });
});

describe('Summit Climb through the Session', () => {
  it('a keyboard run from countdown to results: space pulls, the down arrow steps up a ledge, the arrows lean out of a rock\'s way, the summary is the game summary', async () => {
    let t = 0;
    const raf = new Map<number, () => void>();
    let id = 0;
    const keys = new EventTarget();
    let game: ClimbGame | null = null;
    const session = createSession({
      games: () => ({ ...summitClimb, create: () => { game = createClimbGame(manifest, { sets: 2, summit: 18, setSec: 40, restSec: 3, view: false }); return game; } }),
      ui: () => ({ hud: { set() {}, announce() {}, toast() {} }, audio: { unlock() {}, play() {}, clock: () => ({ now: () => 0, schedule() {}, latencyMs: 0 }) }, store: { get: <T>(_k: string, _s: unknown, f: T) => f, set() {}, remove() {} }, t: (k) => k }),
      raf: (cb) => { raf.set(++id, () => cb(t)); return id; },
      cancelRaf: (i) => { raf.delete(i); },
      now: () => t,
      doc: Object.assign(new EventTarget(), { hidden: false }),
      seed: () => 4,
      keyTarget: keys,
    });
    let over: { seconds: number; score: number; reps: number; cleared: number; hits: number; log: { kind: string }[] } | null = null;
    session.on('over', (s) => { over = s as unknown as typeof over; });
    await session.start('summit-climb', { mode: 'solo', difficulty: 'normal', input: 'keyboard', seated: false });
    const press = (type: 'keydown' | 'keyup', key: string) => keys.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { key, repeat: false, metaKey: false, ctrlKey: false, altKey: false }));
    let frames = 0;
    let pulls = 0;
    let steps = 0;
    let leaning = 0;
    let held: string | null = null;
    while (session.state !== 'results' && t < 600_000) {
      t += 1000 / 60;
      if (session.state === 'running' && game) {
        frames++;
        const g = game as ClimbGame;
        const s = g.state!;
        const ledge = s.phase === 'climb' && s.c.on === 'ledge';
        // A steady player: a pull about every 0.9 seconds, a knee every 0.4 on a ledge.
        if (!ledge && frames % 54 === 0) { press('keydown', ' '); press('keyup', ' '); pulls++; }
        if (ledge && frames % 24 === 0) { press('keydown', 'ArrowDown'); press('keyup', 'ArrowDown'); steps++; }
        // Out of a rock's way: hold an arrow toward an open column while it is coming, and let go after it landed.
        const pr = s.phase === 'climb' ? pendingRock(s) : null;
        const want = pr && pr.warned && pr.left > 0.05 && pr.rock.closed[1] ? (pr.rock.closed[0] ? 'ArrowRight' : 'ArrowLeft') : null;
        if (want !== held) {
          if (held) press('keyup', held);
          if (want) { press('keydown', want); leaning++; }
          held = want;
        }
      }
      const due = [...raf.values()];
      raf.clear();
      for (const cb of due) cb();
    }
    expect(session.state).toBe('results');
    const s = over as unknown as { seconds: number; score: number; reps: number; cleared: number; hits: number; log: { kind: string }[] };
    expect(s.seconds).toBeGreaterThan(30);
    expect(pulls).toBeGreaterThan(20);
    expect(steps).toBeGreaterThan(3);
    expect(leaning).toBeGreaterThan(0);
    expect(s.reps).toBeGreaterThan(20);
    expect(s.score).toBeGreaterThan(100);
    expect(s.log.some((e) => e.kind === 'finish')).toBe(true);
    expect((game as ClimbGame | null)?.state?.c.results.every((r) => r.medal === 'gold')).toBe(true);
    void POINTS;
  });
});
