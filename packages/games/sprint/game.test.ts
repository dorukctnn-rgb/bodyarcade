// Knee Sprint on the Game contract: what the movement channels and events turn into, the HUD, the sounds, two players, the
// seated and the quiet variants, snapshot and restore, the picture on a recording canvas, the manifest, and a whole run
// through the Session with the keyboard.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import type { AudioApi, GameEvent, InputEvent } from '../../core/types/index.ts';
import { FIXED_DT } from '../../core/types/index.ts';
import { createSession } from '../../core/loop/session.ts';
import { DETECTORS } from '../../core/moves/index.ts';
import { copyProblems } from '../../web/catalogue/copy.ts';
import { duoFrame, evt, frame, testContext, type PlayerFrame, type TestCtx } from '../kit-g1/testing/context.ts';
import { budgetProblems } from '../kit-g1/testing/strings.ts';
import { testScene } from '../kit-g1/testing/scene.ts';
import { BREAKPOINTS, type PipPlacement } from '../../core/ui/layout.ts';
import { screenProblems } from '../kit-g1/testing/screens.ts';
import kneeSprint, { manifest, STRINGS } from '../knee-sprint/index.ts';
import { createSprintGame, KEY_LIFT, MET, readLane, type SprintGame } from './game.ts';
import { hurdleIn, LEVELS, type LaneIn } from './sim.ts';
import { sprintBot, type BotKind } from './testing/bot.ts';

const START = (o: Partial<Parameters<SprintGame['start']>[0]> = {}): Parameters<SprintGame['start']>[0] => ({ seed: 1, difficulty: 'normal', seated: false, mode: 'solo', profile: null, ...o });

/** What the movement library would deliver for a bot's body at step k. */
function playerOf(k: number, b: LaneIn): PlayerFrame {
  const events: InputEvent[] = b.steps.map((s) => evt('kneeLift', 'rep', k, { side: s.side || 'L', q: { range: s.k }, value: 110 }));
  for (let i = 0; i < b.jumps; i++) events.push(evt('jump', 'rep', k));
  return { channels: { 'knee.L': b.knees[0], 'knee.R': b.knees[1], 'energy.avg': b.effort, torso: b.torso }, events };
}
const inputOf = (k: number, b: LaneIn): { channels: Record<string, number>; events: InputEvent[] } => ({ channels: playerOf(k, b).channels!, events: playerOf(k, b).events! });

async function ready(o: { start?: Parameters<SprintGame['start']>[0]; ctx?: Parameters<typeof testContext>[0]; scene?: boolean; heats?: number; dist?: number } = {}): Promise<{ game: SprintGame; t: TestCtx }> {
  const scene = o.scene ? testScene(390, 844) : null;
  const t = testContext({ ...(o.ctx ?? {}), ...(scene ? { scene2d: scene.kit } : {}) });
  const game = createSprintGame(manifest, { ...(scene ? {} : { view: false }), ...(o.heats ? { heats: o.heats } : {}), ...(o.dist ? { dist: o.dist } : {}) });
  await game.init(t.ctx);
  game.start(o.start ?? START());
  return { game, t };
}

/** Plays with bots through Game.step (one bot per lane); returns every game event. */
function playGame(game: SprintGame, kinds: BotKind[], o: { steps?: number; from?: number; botSeed?: number; renderEvery?: number } = {}): { events: GameEvent[]; k: number; phase: string } {
  const bots = kinds.map((kind, i) => sprintBot(kind, (o.botSeed ?? 1) + i));
  const events: GameEvent[] = [];
  let k = o.from ?? 0;
  let phase = 'running';
  const max = o.steps ?? 60 * 400;
  while (phase === 'running' && k < (o.from ?? 0) + max) {
    const s = game.state!;
    const ins = bots.map((b, i) => playerOf(k + 1, b.next(s, i, FIXED_DT)));
    const r = game.step(FIXED_DT, kinds.length === 1 ? frame(++k, ins[0]!.channels, ins[0]!.events) : duoFrame(++k, ins[0], ins[1]));
    events.push(...r.events);
    phase = r.phase;
    if (o.renderEvery && k % o.renderEvery === 0) game.render(0.5);
  }
  return { events, k, phase };
}

const types = (events: readonly GameEvent[]): string[] => events.map((e) => (e as { type?: string }).type ?? '');

describe('input to the simulation', () => {
  const lane = (channels: Record<string, number>, events: InputEvent[] = []) => ({ tracking: { ok: true as const }, channels, events, present: true });
  const standing = { seated: false, quiet: false };

  it('a knee lift rep is a step with its peak lift and side; a rep without a range is a good stride (keys and taps)', () => {
    const l = readLane(lane({}, [evt('kneeLift', 'rep', 1, { side: 'R', q: { range: 0.81 } }), evt('kneeLift', 'rep', 1)]), standing);
    expect(l.steps).toEqual([{ k: 0.81, side: 'R' }, { k: KEY_LIFT, side: '' }]);
    expect(l.jumps).toBe(0);
  });

  it('events of other movements and the other kinds of event of the detector are not steps', () => {
    const l = readLane(lane({}, [evt('squat', 'rep', 1), evt('kneeLift', 'holdStart', 1), evt('kneeLift', 'hit', 1)]), standing);
    expect(l.steps).toEqual([]);
    expect(l.jumps).toBe(0);
  });

  it('a jump counts only standing and not quiet: the seated and the quiet variants leave it out', () => {
    const e = [evt('jump', 'rep', 1)];
    expect(readLane(lane({}, e), standing).jumps).toBe(1);
    expect(readLane(lane({}, e), { seated: true, quiet: false }).jumps).toBe(0);
    expect(readLane(lane({}, e), { seated: false, quiet: true }).jumps).toBe(0);
  });

  it('reads the channels: the knees now, the movement energy, the torso line; a missing channel reads as rest', () => {
    const l = readLane(lane({ 'knee.L': 0.4, 'knee.R': 0.7, 'energy.avg': 0.9, torso: 0.8 }), standing);
    expect(l.knees).toEqual([0.4, 0.7]);
    expect(l.effort).toBe(0.9);
    expect(l.torso).toBe(0.8);
    const none = readLane(lane({}), standing);
    expect(none.knees).toEqual([0, 0]);
    expect(none.effort).toBe(0);
    expect(none.torso).toBe(1);
  });
});

describe('Knee Sprint through Game.step', () => {
  it('a perfect runner runs a whole round: the same seed gives the same events, another seed another course', async () => {
    const a = await ready({ start: START({ seed: 5 }), ctx: { seed: 5 } });
    const b = await ready({ start: START({ seed: 5 }), ctx: { seed: 5 } });
    const c = await ready({ start: START({ seed: 6 }), ctx: { seed: 6 } });
    const ra = playGame(a.game, ['perfect']);
    const rb = playGame(b.game, ['perfect']);
    playGame(c.game, ['perfect']);
    expect(ra.phase).toBe('complete');
    expect(types(ra.events)).toEqual(types(rb.events));
    expect(JSON.stringify(a.game.snapshot())).toBe(JSON.stringify(b.game.snapshot()));
    expect(a.game.state!.course).not.toEqual(c.game.state!.course);
    expect(a.game.state!.hurdles.length).toBeGreaterThan(0);
  });

  it('the full round on easy: warm-up, three heats, two rests, then complete; the summary adds up', async () => {
    const { game } = await ready({ start: START({ difficulty: 'easy' }) });
    const r = playGame(game, ['perfect']);
    expect(r.phase).toBe('complete');
    const ev = types(r.events);
    expect(ev.filter((x) => x === 'go')).toHaveLength(3);
    expect(ev.filter((x) => x === 'rest')).toHaveLength(2);
    expect(ev.filter((x) => x === 'finish')).toHaveLength(3);
    expect(ev.at(-1)).toBe('complete');
    const sum = game.summary();
    const finishes = sum.log.filter((e) => e.kind === 'finish');
    const hurdles = sum.log.filter((e) => e.kind === 'hurdle');
    expect(finishes).toHaveLength(3);
    expect(sum.log.filter((e) => e.kind === 'time')).toHaveLength(3);
    expect(sum.score).toBe([...finishes, ...hurdles].reduce((n, e) => n + (e.v ?? 0), 0));
    expect(sum.reps).toBeGreaterThan(100);
    expect(sum.quality ?? 0).toBeGreaterThan(0.8);
    expect(sum.seconds).toBeGreaterThan(LEVELS.easy.heats * 15);
    // The calories follow the knees: a march (4.0) to high knees (7.5), times the seconds spent running.
    const ran = sum.metSeconds / (MET.march + (MET.high - MET.march) * (sum.quality ?? 0));
    expect(ran).toBeGreaterThan(40);
    expect(ran).toBeLessThan(sum.seconds);
  });

  it('on normal the hurdles ask for a jump: the perfect runner clears them, the one who never jumps does not', async () => {
    const jumper = await ready({ start: START({ difficulty: 'normal' }), heats: 2 });
    playGame(jumper.game, ['perfect']);
    const s1 = jumper.game.summary();
    expect(s1.cleared).toBe(4);
    expect(s1.hits).toBe(0);
    expect(s1.log.filter((e) => e.kind === 'hurdle' && e.ok)).toHaveLength(4);
    const walker = await ready({ start: START({ difficulty: 'normal' }), heats: 2 });
    const bot = sprintBot('perfect', 1);
    let k = 0;
    let phase = 'running';
    while (phase === 'running' && k < 60 * 300) {
      const b = bot.next(walker.game.state!, 0, FIXED_DT);
      const x = inputOf(++k, { ...b, jumps: 0 });
      phase = walker.game.step(FIXED_DT, frame(k, x.channels, x.events)).phase;
    }
    const s2 = walker.game.summary();
    expect(s2.cleared ?? 0).toBeLessThan(s1.cleared ?? 0);
    expect(s2.hits).toBeGreaterThan(0);
    // The log names the reason in a movement-library word, never plain "hit".
    expect(s2.log.filter((e) => !e.ok).every((e) => /^(hurdle_none|hurdle_early|hurdle_late|dnf)$/.test(e.kind))).toBe(true);
  });

  it('standing still loses the heats: two called off in a row end the run, and the log says dnf', async () => {
    const { game } = await ready({ start: START({ difficulty: 'easy' }) });
    const r = playGame(game, ['idle']);
    expect(r.phase).toBe('over');
    const sum = game.summary();
    expect(sum.score).toBe(0);
    expect(sum.reps).toBe(0);
    expect(sum.metSeconds).toBe(0);
    expect(sum.log.filter((e) => e.kind === 'dnf').length).toBeGreaterThanOrEqual(2);
  });

  it('knees that stay under the march line are not strides: the runner is told so, and gets nowhere', async () => {
    const low = await ready({ start: START({ difficulty: 'easy' }), heats: 1 });
    const r = playGame(low.game, ['low']);
    expect(r.events.some((e) => (e as { type?: string; code?: string }).type === 'hint' && (e as { code?: string }).code === 'knee_not_high')).toBe(true);
    expect(low.game.state!.lanes[0]!.steps).toBe(0);
    expect(low.game.state!.lanes[0]!.results[0]?.medal ?? 'dnf').toBe('dnf');
  });

  it('a better runner is faster over the same course: perfect, then good, then sloppy', async () => {
    const times: number[] = [];
    for (const kind of ['perfect', 'good', 'sloppy'] as const) {
      const { game } = await ready({ start: START({ difficulty: 'easy' }), heats: 1 });
      playGame(game, [kind]);
      times.push(game.state!.lanes[0]!.results[0]!.time);
    }
    expect(times[0]).toBeGreaterThan(5);
    expect(times[0]!).toBeLessThan(times[1]!);
    expect(times[1]!).toBeLessThan(times[2]!);
  });

  it('restore(snapshot()) continues identically, in a new game instance too', async () => {
    const a = await ready({ start: START({ difficulty: 'normal', seed: 3 }) });
    const first = playGame(a.game, ['good'], { steps: 60 * 40 });
    expect(first.phase).toBe('running');
    const snap = JSON.parse(JSON.stringify(a.game.snapshot()));
    const b = await ready({ start: START({ difficulty: 'normal', seed: 99 }) });
    b.game.restore(snap);
    const botA = sprintBot('good', 7);
    const botB = sprintBot('good', 7);
    const evA: string[] = [];
    const evB: string[] = [];
    let ka = first.k;
    let kb = first.k;
    for (let i = 0; i < 60 * 60; i++) {
      const ia = playerOf(++ka, botA.next(a.game.state!, 0, FIXED_DT));
      const ib = playerOf(++kb, botB.next(b.game.state!, 0, FIXED_DT));
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
    const game = createSprintGame(manifest, { view: false });
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

  it('shows the warm-up move in the command plate, then the get-ready words, the run, and the jump when a hurdle is near', async () => {
    const { game, t } = await ready({ start: START({ difficulty: 'normal' }) });
    game.render(0);
    expect(t.lastHud('prompt')).toEqual({ icon: 'highKnee', text: 'March' });
    // Eight steps at a calm pace end the warm-up.
    const bot = sprintBot('perfect', 1);
    let k = 0;
    while (game.state!.phase === 'warmup' && k < 60 * 30) { const x = inputOf(++k, bot.next(game.state!, 0, FIXED_DT)); game.step(FIXED_DT, frame(k, x.channels, x.events)); }
    game.render(0);
    expect(t.lastHud('prompt')).toBe('Ready');
    expect(t.announced.some((a) => /Heat 1 of 4/.test(a))).toBe(true);
    // The three-two-one, then the run.
    while (game.state!.phase !== 'play' && k < 60 * 60) { game.step(FIXED_DT, frame(++k)); }
    game.render(0);
    expect(t.lastHud('prompt')).toBe('Go');
    expect(t.announced).toContain('Go');
    while (game.state!.hc < 1.5 && k < 60 * 90) { const x = inputOf(++k, bot.next(game.state!, 0, FIXED_DT)); game.step(FIXED_DT, frame(k, x.channels, x.events)); }
    game.render(0);
    expect(t.lastHud('prompt')).toEqual({ icon: 'highKnee', text: 'Knees up' });
    while (hurdleIn(game.state!, 0) > 2 && k < 60 * 200) { const x = inputOf(++k, { ...bot.next(game.state!, 0, FIXED_DT), jumps: 0 }); game.step(FIXED_DT, frame(k, x.channels, x.events)); }
    game.render(0);
    expect(t.lastHud('prompt')).toEqual({ icon: 'stand', text: 'Jump' });
    expect(t.lastHud('timer')).toBeTypeOf('number');
    expect(t.lastHud('score')).toBe(0);
  });

  it('plays a step in the warm-up, the metronome in the run, a coin or a knock at a hurdle and the finish, once each', async () => {
    const { game, t } = await ready({ start: START({ difficulty: 'normal' }), heats: 1 });
    playGame(game, ['perfect'], { renderEvery: 3 });
    game.render(0);
    expect(t.sounds).toContain('rep');
    expect(t.sounds).toContain('metronome');
    expect(t.sounds.filter((s) => s === 'coin')).toHaveLength(2);
    expect(t.sounds).toContain('tick');
    expect(t.sounds).toContain('go');
    // The finish and the end of the round each have their sound.
    expect(t.sounds.filter((s) => s === 'win' || s === 'done').length).toBe(2);
    expect(t.sounds.at(-1)).toBe('win');
    const n = t.sounds.length;
    game.render(0);
    expect(t.sounds.length).toBe(n);
  });

  it('says the reason of a miss in the strip, from the shell strings when it has them and in English when not', async () => {
    const english = await ready({ start: START({ difficulty: 'easy' }), heats: 1 });
    playGame(english.game, ['low'], { steps: 60 * 30, renderEvery: 5 });
    english.game.render(0);
    const said = english.t.hud.filter(([slot, v]) => slot === 'hint' && v !== '').map(([, v]) => v);
    expect(said).toContain('Lift your knees higher');
    const turkish = await ready({ start: START({ difficulty: 'easy' }), heats: 1, ctx: { t: (k) => (k === 'miss.knee_not_high' ? 'Dizlerini daha yükseğe kaldır' : k) } });
    playGame(turkish.game, ['low'], { steps: 60 * 30, renderEvery: 5 });
    expect(turkish.t.hud.filter(([slot, v]) => slot === 'hint' && v !== '').map(([, v]) => v)).toContain('Dizlerini daha yükseğe kaldır');
  });

  it('a sound that fails never fails a frame', async () => {
    const t = testContext();
    (t.ctx.audio as AudioApi).play = () => { throw new Error('no audio device'); };
    const game = createSprintGame(manifest, { view: false });
    await game.init(t.ctx);
    game.start(START({ difficulty: 'easy' }));
    playGame(game, ['perfect'], { steps: 60 * 20 });
    expect(() => game.render(0)).not.toThrow();
  });
});

describe('the seated variant', () => {
  it('races on the movement energy: no steps are needed, a jump does nothing, the calories are the seated ones', async () => {
    const seated = await ready({ start: START({ seated: true, difficulty: 'easy' }), ctx: { seated: true }, heats: 2 });
    expect(seated.game.state!.seated).toBe(true);
    const r = playGame(seated.game, ['perfect']);
    expect(r.phase).toBe('complete');
    const sum = seated.game.summary();
    expect(sum.reps).toBe(0);
    expect(sum.score).toBeGreaterThan(50);
    expect(sum.metSeconds / (seated.game.state!.lanes[0]!.ran)).toBeCloseTo(MET.seated, 0);
    // The command plate asks to swing the arms.
    expect(seated.t.hud.some(([slot, v]) => slot === 'prompt' && (v as { text?: string })?.text === 'Swing arms')).toBe(true);
    // Someone who sits still gets nowhere.
    const still = await ready({ start: START({ seated: true, difficulty: 'easy' }), ctx: { seated: true } });
    expect(playGame(still.game, ['idle']).phase).toBe('over');
  });
});

describe('the quiet variant', () => {
  it('has no jumping and no stamping: a knee at the hip steps over the hurdle, a jump does nothing, and there is no metronome', async () => {
    const quiet = await ready({ start: START({ difficulty: 'normal' }), ctx: { silent: true }, heats: 1 });
    expect(quiet.game.state!.quiet).toBe(true);
    const r = playGame(quiet.game, ['perfect'], { renderEvery: 3 });
    expect(r.phase).toBe('complete');
    expect(types(r.events)).not.toContain('jump');
    expect(quiet.game.summary().cleared).toBe(2);
    expect(quiet.t.sounds).not.toContain('metronome');
    expect(quiet.t.hud.some(([slot, v]) => slot === 'prompt' && (v as { text?: string })?.text === 'Lift knee')).toBe(true);
    // A player who jumps but never lifts a knee to the hip knocks them down.
    const jumper = await ready({ start: START({ difficulty: 'normal' }), ctx: { silent: true }, heats: 1 });
    const bot = sprintBot('perfect', 1);
    let k = 0;
    let phase = 'running';
    const base = sprintBot('good', 1);
    void bot;
    while (phase === 'running' && k < 60 * 200) {
      const b = base.next(jumper.game.state!, 0, FIXED_DT);
      const lo: LaneIn = { ...b, steps: b.steps.map((s) => ({ ...s, k: Math.min(s.k, 0.8) })), jumps: hurdleIn(jumper.game.state!, 0) < 0.3 ? 1 : 0 };
      const x = inputOf(++k, lo);
      phase = jumper.game.step(FIXED_DT, frame(k, x.channels, x.events)).phase;
    }
    expect(jumper.game.summary().cleared).toBe(0);
    expect(jumper.game.summary().hits).toBe(2);
  });
});

describe('two players on one camera', () => {
  it('start with local2: two lanes and no computer, per-player plates and results, the better score is the round\'s', async () => {
    const t = testContext({ duoHud: true });
    const game = createSprintGame(manifest, { view: false, heats: 2 });
    await game.init(t.ctx);
    game.start(START({ mode: 'local2', difficulty: 'normal' }));
    expect(game.state!.lanes).toHaveLength(2);
    expect(game.state!.rival).toBeNull();
    const r = playGame(game, ['perfect', 'good'], { renderEvery: 20 });
    game.render(0);
    expect(r.phase).toBe('complete');
    const sum = game.summary();
    expect(sum.players?.[1]?.score).toBeGreaterThan(100);
    expect(sum.players?.[2]?.score).toBeGreaterThan(50);
    expect(sum.score).toBe(Math.max(sum.players![1]!.score, sum.players![2]!.score));
    expect(sum.players![1]!.score).toBeGreaterThan(sum.players![2]!.score);
    expect(t.plates.some(([p, slot]) => p === 1 && slot === 'score')).toBe(true);
    expect(t.plates.some(([p, slot]) => p === 2 && slot === 'score')).toBe(true);
    expect(sum.log.some((e) => e.player === 2 && e.kind === 'finish')).toBe(true);
    expect(sum.log.some((e) => e.player === 1 && e.kind === 'finish')).toBe(true);
  });

  it('a player who stands still is called off while the other runs on', async () => {
    const t = testContext({ duoHud: true });
    const game = createSprintGame(manifest, { view: false, heats: 1 });
    await game.init(t.ctx);
    game.start(START({ mode: 'local2', difficulty: 'easy' }));
    const r = playGame(game, ['perfect', 'idle'], { renderEvery: 20 });
    expect(r.phase).toBe('complete');
    const sum = game.summary();
    expect(sum.players?.[2]?.score).toBe(0);
    expect(sum.log.some((e) => e.player === 2 && e.kind === 'dnf')).toBe(true);
    expect(sum.log.some((e) => e.player === 1 && e.kind === 'finish')).toBe(true);
  });
});

describe('the picture', () => {
  it('draws a frame on a recording canvas: the track, the runner, the computer, the self view; and the runner is inside the play area', async () => {
    const { game, t } = await ready({ scene: true, start: START({ difficulty: 'easy' }) });
    const scene = (t.ctx.scene2d as unknown as { rects: { play: { x: number; y: number; w: number; h: number }; pip: unknown } });
    const bot = sprintBot('perfect', 1);
    let k = 0;
    for (let i = 0; i < 60 * 24; i++) { const x = inputOf(++k, bot.next(game.state!, 0, FIXED_DT)); game.step(FIXED_DT, frame(k, x.channels, x.events)); if (i % 3 === 0) game.render(0.5); }
    const at = game.view!.runnerAt(0)!;
    const play = scene.rects.play;
    expect(at.x).toBeGreaterThan(play.x);
    expect(at.x).toBeLessThan(play.x + play.w);
    expect(at.y).toBeGreaterThan(play.y);
    expect(at.y).toBeLessThan(play.y + play.h);
    expect(scene.rects.pip).not.toBeNull();
  });

  it('shows the warm-up text, the get-ready panel and the rest as text on the canvas', async () => {
    const { game, t } = await ready({ scene: true, start: START({ difficulty: 'easy' }) });
    const sc = (t.ctx.scene2d as unknown as { ctx: { texts: { text: string }[] } });
    game.render(0);
    const seen = (): string[] => sc.ctx.texts.map((x) => x.text);
    expect(seen().some((x) => /Warm-up/.test(x))).toBe(true);
    const bot = sprintBot('perfect', 1);
    let k = 0;
    while (game.state!.phase !== 'ready' && k < 60 * 60) { const x = inputOf(++k, bot.next(game.state!, 0, FIXED_DT)); game.step(FIXED_DT, frame(k, x.channels, x.events)); }
    game.render(0);
    expect(seen().some((x) => /Heat 1 of 3/.test(x))).toBe(true);
    expect(seen().some((x) => /steps a minute/.test(x))).toBe(true);
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

  /** Runs a whole short round with a bot on a screen and collects what is wrong with every frame drawn. */
  async function sweep(w: number, h: number, corner: PipPlacement, o: { seated?: boolean; quiet?: boolean; local2?: boolean } = {}): Promise<{ problems: string[]; frames: number; phases: Set<string> }> {
    const scene = testScene(w, h, { corner });
    const t = testContext({ scene2d: scene.kit, seated: o.seated ?? false, silent: o.quiet ?? false, duoHud: o.local2 ?? false });
    const game = createSprintGame(manifest, { heats: 2, dist: 50, restSec: 3 });
    await game.init(t.ctx);
    game.start(START({ difficulty: 'normal', seated: o.seated ?? false, mode: o.local2 ? 'local2' : 'solo' }));
    const kinds: BotKind[] = o.local2 ? ['perfect', 'good'] : ['good'];
    const bots = kinds.map((kind, i) => sprintBot(kind, 3 + i));
    const problems = new Set<string>();
    const phases = new Set<string>();
    let frames = 0;
    for (let k = 1; k < 60 * 150 && game.state!.phase !== 'complete' && game.state!.phase !== 'over'; k++) {
      const ins = bots.map((b, i) => playerOf(k, b.next(game.state!, i, FIXED_DT)));
      game.step(FIXED_DT, kinds.length === 1 ? frame(k, ins[0]!.channels, ins[0]!.events) : duoFrame(k, ins[0], ins[1]));
      if (k % 20 === 0) {
        scene.ctx.texts.length = 0;
        game.render(0.5);
        frames++;
        phases.add(game.state!.phase);
        const heroes = kinds.map((_, i) => game.view!.runnerAt(i));
        for (const hero of heroes) for (const p of screenProblems(scene, hero, `${w}x${h} ${corner} ${game.state!.phase}`)) problems.add(p);
      }
    }
    return { problems: [...problems], frames, phases };
  }

  it('on every one of the ten screens nothing runs off the screen and the runner is clear of the plates and the self view', async () => {
    for (const b of BREAKPOINTS) {
      const r = await sweep(b.w, b.h, 'bottom-right');
      expect(r.problems, b.label).toEqual([]);
      expect(r.frames, b.label).toBeGreaterThan(40);
      for (const ph of ['warmup', 'ready', 'play', 'finish', 'rest']) expect(r.phases.has(ph), `${b.label} ${ph}`).toBe(true);
    }
  });

  it('in every corner of the self view, on a phone, a phone on its side and a laptop', async () => {
    for (const [w, h] of [[390, 844], [844, 390], [1280, 800]] as const) {
      for (const corner of CORNERS) expect((await sweep(w, h, corner)).problems, `${w}x${h} ${corner}`).toEqual([]);
    }
  });

  it('the seated and the quiet runners too, and two players on a laptop, a wide laptop and a TV', async () => {
    for (const [w, h] of [[390, 844], [1280, 800]] as const) {
      for (const v of [{ seated: true }, { quiet: true }]) expect((await sweep(w, h, 'bottom-right', v)).problems, `${w}x${h} ${JSON.stringify(v)}`).toEqual([]);
    }
    for (const [w, h] of [[1280, 800], [1440, 900], [1920, 1080]] as const) expect((await sweep(w, h, 'bottom-right', { local2: true })).problems, `${w}x${h} local2`).toEqual([]);
  });
});

describe('the manifest and the strings', () => {
  it('is valid against the catalogue schema and lists only what works', () => {
    const schema = JSON.parse(readFileSync(new URL('../../web/catalogue/manifest.schema.json', import.meta.url), 'utf8'));
    const validate = new Ajv2020({ allErrors: true }).compile(schema);
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    expect(manifest.id).toBe('knee-sprint');
    expect(manifest.modes).toEqual(['solo', 'local2', 'duel']);
    expect(manifest.free).toBe(true);
    expect(manifest.seated && manifest.silentSafe && manifest.lowImpact).toBe(true);
    for (const d of manifest.detectors) expect(DETECTORS[d.id], d.id).toBeTypeOf('function');
    // The knee lift detector comes last so that its channels win.
    expect(manifest.detectors.map((d) => d.id)).toEqual(['jump', 'energy', 'kneeLift']);
  });

  it('the module has the keys and the swipes, and creates a game', () => {
    expect(kneeSprint.manifest).toBe(manifest);
    expect(kneeSprint.controls?.keys?.ArrowLeft).toEqual({ event: 'kneeLift' });
    expect(kneeSprint.controls?.keys?.[' ']).toEqual({ event: 'jump' });
    expect(kneeSprint.controls?.touch?.tap).toEqual({ event: 'kneeLift' });
    expect(kneeSprint.controls?.touch?.up).toEqual({ event: 'jump' });
    expect(kneeSprint.create().manifest).toBe(manifest);
  });

  it('every string follows the house rules, in every language, and every language has the commands', () => {
    for (const [lang, table] of Object.entries(STRINGS)) {
      for (const [k, v] of Object.entries(table ?? {})) expect(copyProblems(v), `${lang} ${k}`).toEqual([]);
    }
    for (const lang of ['tr', 'de', 'es', 'fr'] as const) {
      for (const k of ['cmd.march', 'cmd.run', 'cmd.jump', 'cmd.knee', 'warm.title', 'warm.body', 'ready.title', 'rest.title', 'miss.knee_not_high', 'miss.hurdle_none']) expect(STRINGS[lang]?.[k], `${lang} ${k}`).toBeTruthy();
    }
    expect(Object.keys(STRINGS.en ?? {}).length).toBeGreaterThan(30);
  });

  it('the commands and the reasons keep to the text budgets of design/LAYOUT.md section 8', () => {
    expect(budgetProblems(STRINGS, { commands: /^(cmd\.|ready\.title$|rest\.title$)/, reasons: /^miss\./ })).toEqual([]);
  });

  it('the duration of the manifest is the length of a normal round: warm-up, four heats and three rests', () => {
    const n = LEVELS.normal;
    const heat = 3 + 2 * (n.rival100 + 2) + 3;
    expect(manifest.durationSec).toBeGreaterThanOrEqual(n.heats * 20 + (n.heats - 1) * n.restSec);
    expect(manifest.durationSec).toBeLessThanOrEqual(n.heats * heat + (n.heats - 1) * n.restSec + 30);
  });
});

describe('Knee Sprint through the Session', () => {
  it('a keyboard run from countdown to results: the arrows step in turn, space jumps a hurdle, the summary is the game summary', async () => {
    let t = 0;
    const raf = new Map<number, () => void>();
    let id = 0;
    const keys = new EventTarget();
    let game: SprintGame | null = null;
    const session = createSession({
      games: () => ({ ...kneeSprint, create: () => { game = createSprintGame(manifest, { heats: 2, view: false }); return game; } }),
      ui: () => ({ hud: { set() {}, announce() {}, toast() {} }, audio: { unlock() {}, play() {}, clock: () => ({ now: () => 0, schedule() {}, latencyMs: 0 }) }, store: { get: <T>(_k: string, _s: unknown, f: T) => f, set() {}, remove() {} }, t: (k) => k }),
      raf: (cb) => { raf.set(++id, () => cb(t)); return id; },
      cancelRaf: (i) => { raf.delete(i); },
      now: () => t,
      doc: Object.assign(new EventTarget(), { hidden: false }),
      seed: () => 4,
      keyTarget: keys,
    });
    let over: { seconds: number; score: number; reps: number; cleared?: number; log: { kind: string }[] } | null = null;
    session.on('over', (s) => { over = s as unknown as typeof over; });
    await session.start('knee-sprint', { mode: 'solo', difficulty: 'normal', input: 'keyboard', seated: false });
    const press = (type: 'keydown' | 'keyup', key: string) => keys.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { key, repeat: false, metaKey: false, ctrlKey: false, altKey: false }));
    let frames = 0;
    let stride = 0;
    let steps = 0;
    let jumps = 0;
    while (session.state !== 'results' && t < 600_000) {
      t += 1000 / 60;
      if (session.state === 'running' && game) {
        frames++;
        const s = (game as SprintGame).state!;
        // A steady player: a step every 28 frames (about 128 a minute), alternately left and right; space when a hurdle is near.
        if (frames % 28 === 0) { const key = stride++ % 2 === 0 ? 'ArrowLeft' : 'ArrowRight'; press('keydown', key); press('keyup', key); steps++; }
        if (s.phase === 'play' && hurdleIn(s, 0) < 0.3 && s.lanes[0]!.sinceAct > 0.7) { press('keydown', ' '); press('keyup', ' '); jumps++; }
      }
      const due = [...raf.values()];
      raf.clear();
      for (const cb of due) cb();
    }
    expect(session.state).toBe('results');
    const s = over as unknown as { seconds: number; score: number; reps: number; cleared: number; log: { kind: string }[] };
    expect(s.seconds).toBeGreaterThan(30);
    expect(steps).toBeGreaterThan(50);
    expect(s.reps).toBeGreaterThan(40);
    expect(jumps).toBeGreaterThan(0);
    expect(s.cleared).toBeGreaterThan(0);
    expect(s.score).toBeGreaterThan(100);
    expect(s.log.some((e) => e.kind === 'finish')).toBe(true);
  });
});
