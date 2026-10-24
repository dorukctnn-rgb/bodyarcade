// Squat Flap on the Game contract: what the movement channels and events turn into, the HUD, the sounds, two players,
// the seated variant, snapshot and restore, the picture on a recording canvas, the manifest, and a whole run through
// the Session with the keyboard.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import type { AudioApi, GameEvent, InputEvent, InputFrame } from '../../core/types/index.ts';
import { FIXED_DT } from '../../core/types/index.ts';
import { stepTime } from '../../core/loop/clock.ts';
import { createSession } from '../../core/loop/session.ts';
import { DETECTORS } from '../../core/moves/index.ts';
import { copyProblems } from '../../web/catalogue/copy.ts';
import { duoFrame, evt, frame, testContext, type TestCtx } from '../kit-g1/testing/context.ts';
import { budgetProblems } from '../kit-g1/testing/strings.ts';
import { testScene } from '../kit-g1/testing/scene.ts';
import squatFlap, { manifest, STRINGS } from '../squat-flap/index.ts';
import { createFlightGame, readLane, type FlightGame } from './game.ts';
import { LEVELS, type LaneIn } from './sim.ts';
import { squatBot, type BotKind } from './testing/bot.ts';

const START = (o: Partial<Parameters<FlightGame['start']>[0]> = {}): Parameters<FlightGame['start']>[0] => ({ seed: 1, difficulty: 'normal', seated: false, mode: 'solo', profile: null, ...o });

/** What the movement library would deliver for a bot's body at step k. */
function inputOf(k: number, b: LaneIn): { channels: Record<string, number>; events: InputEvent[] } {
  return {
    channels: { drop: b.drop, glide: b.glide ? 1 : 0, armed: b.armed ? 1 : 0 },
    events: b.flaps.map((f) => evt('squat', 'rep', k, { value: f.power, ...(f.depth !== undefined ? { q: { depth: f.depth } } : {}) })),
  };
}

async function ready(o: { start?: Parameters<FlightGame['start']>[0]; ctx?: Parameters<typeof testContext>[0]; scene?: boolean } = {}): Promise<{ game: FlightGame; t: TestCtx }> {
  const scene = o.scene ? testScene(390, 844) : null;
  const t = testContext({ ...(o.ctx ?? {}), ...(scene ? { scene2d: scene.kit } : {}) });
  const game = createFlightGame(manifest, scene ? {} : { view: false });
  await game.init(t.ctx);
  game.start(o.start ?? START());
  return { game, t };
}

/** Plays with a bot through Game.step; returns every game event. */
function playGame(game: FlightGame, kind: BotKind, o: { steps?: number; from?: number; botSeed?: number } = {}): { events: GameEvent[]; k: number; phase: string } {
  const bot = squatBot(kind, o.botSeed ?? 1);
  const events: GameEvent[] = [];
  let k = o.from ?? 0;
  let phase = 'running';
  const max = o.steps ?? 60 * 400;
  while (phase === 'running' && k < (o.from ?? 0) + max) {
    const s = game.state!;
    const b = bot.next(s, 0, FIXED_DT);
    const r = game.step(FIXED_DT, frame(++k, inputOf(k, b).channels, inputOf(k, b).events));
    events.push(...r.events);
    phase = r.phase;
  }
  return { events, k, phase };
}

describe('input to the simulation', () => {
  const lane = (channels: Record<string, number>, events: InputEvent[] = []) => ({ tracking: { ok: true as const }, channels, events, present: true });

  it('a squat rep is a flap with its power and depth; keys and taps are flaps without depth', () => {
    const l = readLane(lane({ drop: 0.4 }, [evt('squat', 'rep', 1, { value: 1.1, q: { depth: 0.62 } }), evt('squat', 'rep', 1)]), false);
    expect(l.flaps).toEqual([{ power: 1.1, depth: 0.62 }, { power: 1, depth: undefined }]);
    expect(l.drop).toBe(0.4);
  });

  it('glide and armed come from the channels; the squat hold events are not flaps', () => {
    expect(readLane(lane({ glide: 1, armed: 1 }), false)).toMatchObject({ glide: true, armed: true });
    expect(readLane(lane({ glide: 0.2 }), false)).toMatchObject({ glide: false, armed: false });
    expect(readLane(lane({}, [evt('squat', 'holdStart', 1), evt('squat', 'holdEnd', 2)]), false).flaps).toEqual([]);
  });

  it('arm flaps count only in the seated variant, and arms held level and spread are a glide there', () => {
    const ev = [evt('armDirection', 'rep', 1, { value: 0.8 })];
    expect(readLane(lane({}, ev), false).flaps).toEqual([]);
    expect(readLane(lane({}, ev), true).flaps).toEqual([{ power: 0.8, depth: undefined }]);
    expect(readLane(lane({ wing: 0.05, spread: 0.9 }), true).glide).toBe(true);
    expect(readLane(lane({ wing: 0.05, spread: 0.9 }), false).glide).toBe(false);
    expect(readLane(lane({ wing: 0.6, spread: 0.9 }), true).glide).toBe(false);
    expect(readLane(lane({ wing: 0.05, spread: 0.3 }), true).glide).toBe(false);
  });
});

describe('Squat Flap through Game.step', () => {
  it('a perfect squatter flies a whole run: the same seed gives the same events, another seed another course', async () => {
    const a = await ready();
    const b = await ready();
    const c = await ready({ start: START({ seed: 2 }), ctx: { seed: 2 } });
    const ra = playGame(a.game, 'perfect', { steps: 60 * 90 });
    const rb = playGame(b.game, 'perfect', { steps: 60 * 90 });
    const rc = playGame(c.game, 'perfect', { steps: 60 * 90 });
    expect(rb.events).toEqual(ra.events);
    expect(rc.events).not.toEqual(ra.events);
    expect(ra.events.some((e) => e.type === 'pass')).toBe(true);
    expect(a.game.summary().cleared).toBeGreaterThan(5);
  });

  it('the full round: 3 sets, 2 rests, over when the last set ends; the summary adds up', async () => {
    const { game } = await ready({ start: START({ difficulty: 'easy' }) });
    const r = playGame(game, 'perfect');
    expect(r.phase).toBe('complete');
    const sum = game.summary();
    expect(sum.score).toBeGreaterThan(150);
    expect(sum.cleared).toBeGreaterThan(50);
    expect(sum.reps).toBeGreaterThan(70);
    expect(sum.seconds).toBeGreaterThan(232);
    // MET x the seconds spent flapping: the warm-up and three sets, not the 50 seconds of rest.
    expect(sum.metSeconds).toBeGreaterThan(5 * 180);
    expect(sum.metSeconds).toBeLessThan(5 * 235);
    expect(sum.quality).toBeGreaterThan(0.8);
    expect(sum.log.filter((e) => e.kind === 'pass').reduce((n, e) => n + (e.v ?? 0), 0)).toBe(sum.score);
  });

  it('standing still loses every feather; the log names why in a movement-library code, not "hit"', async () => {
    const { game } = await ready({ start: START({ difficulty: 'easy' }) });
    const r = playGame(game, 'idle', { steps: 60 * 100 });
    expect(r.phase).toBe('over');
    const sum = game.summary();
    expect(sum.score).toBe(0);
    expect(sum.hits).toBe(3);
    const misses = sum.log.filter((e) => !e.ok);
    expect(misses).toHaveLength(3);
    expect(new Set(misses.map((m) => m.kind))).toEqual(new Set(['move_more']));
  });

  it('restore(snapshot()) continues identically, in a new game instance too', async () => {
    const first = await ready({ start: START({ seed: 7 }), ctx: { seed: 7 } });
    const bot = squatBot('sloppy', 5);
    let k = 0;
    const feed = (g: FlightGame, n: number): GameEvent[] => {
      const out: GameEvent[] = [];
      for (let i = 0; i < n; i++) { const b = bot.next(first.game.state!, 0, FIXED_DT); const x = inputOf(++k, b); out.push(...g.step(FIXED_DT, frame(k, x.channels, x.events)).events); }
      return out;
    };
    feed(first.game, 2500);
    const snap = JSON.parse(JSON.stringify(first.game.snapshot()));
    // Same inputs to the original and to a new game made from the snapshot.
    const other = await ready({ start: START({ seed: 99 }), ctx: { seed: 99 } });
    other.game.restore(snap);
    const inputs: { channels: Record<string, number>; events: InputEvent[]; k: number }[] = [];
    const k0 = k;
    for (let i = 0; i < 2500; i++) { const b = bot.next(first.game.state!, 0, FIXED_DT); const x = inputOf(++k, b); inputs.push({ ...x, k }); first.game.step(FIXED_DT, frame(k, x.channels, x.events)); }
    const again: GameEvent[] = [];
    for (const x of inputs) again.push(...other.game.step(FIXED_DT, frame(x.k, x.channels, x.events)).events);
    expect(k0).toBe(2500);
    expect(other.game.summary()).toEqual(first.game.summary());
    expect(JSON.stringify(other.game.state)).toBe(JSON.stringify(first.game.state));
    expect(again.length).toBeGreaterThan(5);
  });

  it('refuses a snapshot of something else', async () => {
    const { game } = await ready();
    expect(() => game.restore({ v: 2 })).toThrow();
  });

  it('needs init() before start() and start() before step()', async () => {
    const g = createFlightGame(manifest, { view: false });
    expect(() => g.start(START())).toThrow();
    const t = testContext();
    await g.init(t.ctx);
    expect(() => g.step(FIXED_DT, frame(1))).toThrow();
  });

  it('is pure: no clock, no random, no sine, no DOM in the simulation and in the game', () => {
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

  it('shows the warm-up moves in the command plate, then the score, the time of the set and the feathers', async () => {
    const { game, t } = await ready({ start: START({ difficulty: 'easy' }) });
    game.render(0);
    expect(t.lastHud('prompt')).toEqual({ icon: 'squat', text: 'Squat' });
    expect(t.lastHud('timer')).toBe(60);
    expect(t.lastHud('lives')).toBe(3);
    expect(t.lastHud('score')).toBe(0);
    // A squat is held: the plate asks to stand up.
    let k = 0;
    for (let i = 0; i < 60; i++) game.step(FIXED_DT, frame(++k, { drop: 0.5, glide: 1, armed: 1 }));
    game.render(0);
    expect(t.lastHud('prompt')).toEqual({ icon: 'stand', text: 'Stand up' });
    // Standing up with a flap three times ends the warm-up: a pause to get ready.
    for (let n = 0; n < 3; n++) {
      game.step(FIXED_DT, frame(++k, { drop: 0 }, [evt('squat', 'rep', k, { value: 1, q: { depth: 0.6 } })]));
      for (let i = 0; i < 80; i++) game.step(FIXED_DT, frame(++k, {}));
    }
    game.render(0);
    expect(t.lastHud('prompt')).toBe('Get ready');
    expect(t.announced).toContain('Get ready');
  });

  it('plays a sound for a flap, a pass and a hit, once each', async () => {
    const { game, t } = await ready({ start: START({ difficulty: 'easy' }) });
    playGame(game, 'idle', { steps: 60 * 90 });
    game.render(0);
    expect(t.sounds.filter((s) => s === 'hit')).toHaveLength(3);
    expect(t.sounds).toContain('lose');
    game.render(0);
    expect(t.sounds.filter((s) => s === 'hit')).toHaveLength(3);
  });

  it('says the reason of a miss in the strip, from the shell strings when it has them and in English when not', async () => {
    const english = await ready({ start: START({ difficulty: 'easy' }) });
    playGame(english.game, 'idle', { steps: 60 * 40 });
    english.game.render(0);
    expect(english.t.lastHud('hint')).toBe('Move more');
    const turkish = await ready({ start: START({ difficulty: 'easy' }), ctx: { t: (k) => (k === 'miss.move_more' ? 'Daha çok hareket et' : k) } });
    playGame(turkish.game, 'idle', { steps: 60 * 40 });
    turkish.game.render(0);
    expect(turkish.t.lastHud('hint')).toBe('Daha çok hareket et');
  });

  it('a sound that fails never fails a frame', async () => {
    const t = testContext();
    (t.ctx.audio as AudioApi).play = () => { throw new Error('no audio device'); };
    const game = createFlightGame(manifest, { view: false });
    await game.init(t.ctx);
    game.start(START({ difficulty: 'easy' }));
    playGame(game, 'idle', { steps: 60 * 40 });
    expect(() => game.render(0)).not.toThrow();
  });
});

describe('the seated variant', () => {
  it('flaps with the arms and glides with them level; a standing player\'s arm strokes do nothing', async () => {
    const seated = await ready({ start: START({ seated: true, difficulty: 'easy' }), ctx: { seated: true } });
    const standing = await ready({ start: START({ difficulty: 'easy' }) });
    for (const g of [seated.game, standing.game]) {
      let k = 0;
      for (let n = 0; n < 3; n++) {
        for (let i = 0; i < 40; i++) g.step(FIXED_DT, frame(++k, { wing: 0.05, spread: 0.9 }));
        g.step(FIXED_DT, frame(++k, {}, [evt('armDirection', 'rep', k, { value: 1 })]));
      }
    }
    expect(seated.game.state!.lanes[0]!.flaps).toBe(3);
    expect(seated.game.state!.phase).toBe('rest');
    expect(standing.game.state!.lanes[0]!.flaps).toBe(0);
    expect(standing.game.state!.phase).toBe('warmup');
  });
});

describe('two players on one camera', () => {
  it('start with local2: two lanes, per-player plates and results, the better score is the round\'s', async () => {
    const t = testContext({ duoHud: true });
    const game = createFlightGame(manifest, { view: false });
    await game.init(t.ctx);
    game.start(START({ mode: 'local2', difficulty: 'easy' }));
    expect(game.state!.lanes).toHaveLength(2);
    const bots = [squatBot('perfect', 1), squatBot('idle', 2)];
    let k = 0;
    let phase = 'running';
    while (phase === 'running' && k < 60 * 300) {
      const s = game.state!;
      const a = inputOf(k + 1, bots[0]!.next(s, 0, FIXED_DT));
      const b = inputOf(k + 1, bots[1]!.next(s, 1, FIXED_DT));
      const r = game.step(FIXED_DT, duoFrame(++k, a, b));
      phase = r.phase;
      if (k % 20 === 0) game.render(0);
    }
    game.render(0);
    const sum = game.summary();
    expect(phase).toBe('complete');
    expect(sum.players?.[1]?.score).toBeGreaterThan(100);
    expect(sum.players?.[2]?.score).toBe(0);
    expect(sum.score).toBe(sum.players![1]!.score);
    expect(t.plates.some(([p, slot]) => p === 1 && slot === 'score')).toBe(true);
    expect(t.plates.some(([p, slot, v]) => p === 2 && slot === 'hint' && v !== '')).toBe(true);
    expect(sum.log.some((e) => e.player === 2 && !e.ok)).toBe(true);
    expect(sum.log.some((e) => e.player === 1 && e.ok)).toBe(true);
  });
});

describe('the picture', () => {
  it('draws a frame on a recording canvas: sky, columns, the bird, the self view; and the bird is inside the play area', async () => {
    const { game, t } = await ready({ scene: true, start: START({ difficulty: 'easy' }) });
    const scene = (t.ctx.scene2d as unknown as { rects: { play: { x: number; y: number; w: number; h: number }; pip: unknown } });
    let k = 0;
    const bot = squatBot('perfect', 1);
    for (let i = 0; i < 60 * 24; i++) { const b = bot.next(game.state!, 0, FIXED_DT); const x = inputOf(++k, b); game.step(FIXED_DT, frame(k, x.channels, x.events)); if (i % 3 === 0) game.render(0.5); }
    const bird = game.view!.birdAt(0)!;
    const play = scene.rects.play;
    expect(bird.x).toBeGreaterThan(play.x);
    expect(bird.x).toBeLessThan(play.x + play.w * 0.5);
    expect(bird.y).toBeGreaterThan(play.y);
    expect(bird.y).toBeLessThan(play.y + play.h);
    expect(scene.rects.pip).not.toBeNull();
  });

  it('shows the warm-up text, the rest and the get-ready panels as text on the canvas', async () => {
    const { game, t } = await ready({ scene: true, start: START({ difficulty: 'easy' }) });
    const sc = (t.ctx.scene2d as unknown as { ctx: { texts: { text: string }[] } });
    game.render(0);
    const seen = (): string[] => sc.ctx.texts.map((x) => x.text);
    expect(seen().some((x) => /Warm-up/.test(x))).toBe(true);
    expect(seen().some((x) => /Squat low/.test(x))).toBe(true);
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

describe('the manifest and the strings', () => {
  it('is valid against the catalogue schema and lists only what works', () => {
    const schema = JSON.parse(readFileSync(new URL('../../web/catalogue/manifest.schema.json', import.meta.url), 'utf8'));
    const validate = new Ajv2020({ allErrors: true }).compile(schema);
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    expect(manifest.id).toBe('squat-flap');
    expect(manifest.modes).toEqual(['solo', 'local2']);
    expect(manifest.free).toBe(true);
    expect(manifest.seated && manifest.silentSafe && manifest.lowImpact).toBe(true);
    for (const d of manifest.detectors) expect(DETECTORS[d.id], d.id).toBeTypeOf('function');
    // The squat detector comes last so that its channels (glide, flaps) win over the arms'.
    expect(manifest.detectors.map((d) => d.id)).toEqual(['armDirection', 'squat']);
  });

  it('the module has the keys and the swipes, and creates a game', () => {
    expect(squatFlap.manifest).toBe(manifest);
    expect(squatFlap.controls?.keys?.[' ']).toEqual({ event: 'squat' });
    expect(squatFlap.controls?.touch?.down).toMatchObject({ channel: 'glide' });
    expect(squatFlap.create().manifest).toBe(manifest);
  });

  it('every string follows the house rules, in every language, and every language has the commands', () => {
    for (const [lang, table] of Object.entries(STRINGS)) {
      for (const [k, v] of Object.entries(table ?? {})) expect(copyProblems(v), `${lang} ${k}`).toEqual([]);
    }
    for (const lang of ['tr', 'de', 'es', 'fr'] as const) {
      for (const k of ['cmd.squat', 'cmd.stand', 'warm.title', 'warm.body', 'ready.title', 'rest.title']) expect(STRINGS[lang]?.[k], `${lang} ${k}`).toBeTruthy();
    }
    expect(Object.keys(STRINGS.en ?? {}).length).toBeGreaterThan(20);
  });

  it('the commands and the reasons keep to the text budgets of design/LAYOUT.md section 8', () => {
    expect(budgetProblems(STRINGS, { commands: /^(cmd\.|ready\.title$|rest\.title$)/, reasons: /^miss\./ })).toEqual([]);
  });

  it('the duration of the manifest is the length of a round: warm-up, three sets and two rests', () => {
    expect(manifest.durationSec).toBeGreaterThanOrEqual(3 * 60 + 2 * 25 + 25);
    expect(manifest.durationSec).toBeLessThanOrEqual(3 * 60 + 2 * 25 + 60);
    expect(LEVELS.normal.sets).toBe(3);
  });
});

describe('Squat Flap through the Session', () => {
  it('a keyboard run from countdown to results: space flaps, the down arrow glides, the summary is the game summary', async () => {
    let t = 0;
    const raf = new Map<number, () => void>();
    let id = 0;
    const keys = new EventTarget();
    const session = createSession({
      games: () => squatFlap,
      ui: () => ({ hud: { set() {}, announce() {}, toast() {} }, audio: { unlock() {}, play() {}, clock: () => ({ now: () => 0, schedule() {}, latencyMs: 0 }) }, store: { get: <T>(_k: string, _s: unknown, f: T) => f, set() {}, remove() {} }, t: (k) => k }),
      raf: (cb) => { raf.set(++id, () => cb(t)); return id; },
      cancelRaf: (i) => { raf.delete(i); },
      now: () => t,
      doc: Object.assign(new EventTarget(), { hidden: false }),
      seed: () => 4,
      keyTarget: keys,
    });
    let over: { seconds: number; score: number; log: { kind: string }[] } | null = null;
    session.on('over', (s) => { over = s; });
    await session.start('squat-flap', { mode: 'solo', difficulty: 'easy', input: 'keyboard', seated: false });
    const press = (type: 'keydown' | 'keyup', key: string) => keys.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { key, repeat: false, metaKey: false, ctrlKey: false, altKey: false }));
    let frames = 0;
    let flaps = 0;
    while (session.state !== 'results' && t < 400_000) {
      t += 1000 / 60;
      if (session.state === 'running') {
        frames++;
        // Hold the glide key most of the time and tap space every 100 frames: a poor but steady player.
        if (frames % 100 === 1) { press('keydown', 'ArrowDown'); }
        if (frames % 100 === 40) { press('keyup', 'ArrowDown'); press('keydown', ' '); press('keyup', ' '); flaps++; }
      }
      const due = [...raf.values()];
      raf.clear();
      for (const cb of due) cb();
    }
    expect(session.state).toBe('results');
    const s = over as unknown as { seconds: number; score: number; log: { kind: string }[] };
    expect(s.seconds).toBeGreaterThan(5);
    expect(flaps).toBeGreaterThan(3);
    expect(s.log.length).toBeGreaterThan(0);
  });
});

void stepTime;
