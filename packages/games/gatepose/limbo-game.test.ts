// Limbo Bend on the Game contract: the manifest, the HUD, the sounds, the reasons on the strip, the variants and their detector,
// two players on one camera, snapshot and restore, the view on the ten screens and in every corner, and whole runs through the
// Session (keyboard, and the camera's detector).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPoseFeed } from '../../core/input/pose-feed.ts';
import type { GameManifest, GameModule, InputFrame, Scene2D, StartOptions } from '../../core/types/index.ts';
import { FIXED_DT } from '../../core/types/index.ts';
import { BREAKPOINTS } from '../../core/ui/layout.ts';
import type { PipPlacement } from '../../core/ui/layout.ts';
import { checkEntry } from '../../web/catalogue/validate.ts';
import { tilesDir } from '../../web/catalogue/load.ts';
import { copyProblems } from '../../web/catalogue/copy.ts';
import { stringTables } from '../../core/ui/i18n/index.ts';
import { clockedSession, fakeCamera, fakePose } from '../_shared/testing/fakes.ts';
import { duoFrame, inputFrame, nonFiniteCalls, testContext, testKit, testKitDuo } from '../_shared/testing/context.ts';
import { MISS_EN } from '../_shared/reasons.ts';
import limboBend, { manifest as realManifest, limboBendModule } from '../limbo-bend/index.ts';
import { createLimboBendGame, lbDetectors, type LimboGameOptions } from './limbo-game.ts';
import { lbLayout } from './limbo-view.ts';
import type { LimboSim } from './limbo.ts';
import type { GpTiming } from './plan.ts';
import { LB_STRINGS } from './strings.ts';
import { limboBot, type LimboBot } from './testing/limbo-bot.ts';

const fresh = (): GameManifest => structuredClone(realManifest);
const SHORT: Partial<GpTiming> = { sets: 1, workS: 24, finaleS: 2 };
const MED: Partial<GpTiming> = { sets: 2, workS: 22, restS: 6, finaleS: 2 };

interface Rig { game: ReturnType<typeof createLimboBendGame>; ctx: ReturnType<typeof testContext>; manifest: GameManifest }

async function rig(o: { seed?: number; difficulty?: string; seated?: boolean; silent?: boolean; players?: 1 | 2; scene2d?: Scene2D; t?: (k: string, v?: Record<string, string | number>) => string; timing?: Partial<GpTiming> } = {}): Promise<Rig> {
  const manifest = fresh();
  const ctx = testContext({ seed: o.seed ?? 3, flags: { seated: o.seated ?? false, silent: o.silent ?? false }, duo: o.players === 2, ...(o.scene2d ? { scene2d: o.scene2d } : {}), ...(o.t ? { t: o.t as never } : {}) });
  const options: LimboGameOptions = { timing: o.timing ?? SHORT };
  const game = createLimboBendGame(manifest, options);
  await game.init(ctx);
  const start: StartOptions = { seed: o.seed ?? 3, difficulty: o.difficulty ?? 'normal', seated: o.seated ?? false, mode: o.players === 2 ? 'local2' : 'solo', profile: null };
  game.start(start);
  return { game, ctx, manifest };
}

const sim = (r: Rig): LimboSim => r.game.sim as LimboSim;

/** Plays the game through its own API with scripted players; renders every fourth step. */
function play(r: Rig, bots: LimboBot[], o: { from?: number; steps?: number; renderEvery?: number } = {}): { k: number; phase: string } {
  let k = o.from ?? 0;
  let phase = 'running';
  const end = o.steps !== undefined ? k + o.steps : Infinity;
  while (phase === 'running' && k < end && k < 200_000) {
    k++;
    const frame: InputFrame = bots.length === 2
      ? duoFrame(k, { channels: { ...bots[0]!.at(k).ch } }, { channels: { ...bots[1]!.at(k).ch } }, 'pose')
      : inputFrame(k, { ...bots[0]!.at(k).ch }, [], { source: 'pose' });
    phase = r.game.step(FIXED_DT, frame).phase;
    if (k % (o.renderEvery ?? 4) === 0) r.game.render(0.5);
  }
  return { k, phase };
}

describe('the manifest', () => {
  it('passes the catalogue schema and the house rules in English and Turkish, with its tile art', () => {
    const r = checkEntry(realManifest, 'packages/games/limbo-bend/manifest.json', { requiredLangs: ['en', 'tr'], tilesDir: tilesDir() });
    expect(r.problems).toEqual([]);
    expect(r.entry).not.toBeNull();
  });

  it('says only what the game does: one or two players, the variants, the detector, the length, Pro', () => {
    expect(realManifest.modes).toEqual(['solo', 'local2']);
    expect(realManifest.seated).toBe(true);
    expect(realManifest.silentSafe).toBe(true);
    expect(realManifest.lowImpact).toBe(true);
    expect(realManifest.free).toBe(false);
    expect(realManifest.template).toBe('gate');
    expect(realManifest.framing).toBe('upper');
    expect(realManifest.detectors.map((d) => d.id)).toEqual(['sideBend']);
    expect(realManifest.durationSec).toBe(180);
    expect(realManifest.met).toBe(2.3);
    expect((realManifest as unknown as { catalogue?: unknown }).catalogue).toBeDefined();
  });

  it('the module hands the catalogue the same manifest, the keys, the swipes and the words in five languages', () => {
    expect(limboBend.manifest).toBe(realManifest);
    expect(Object.keys(limboBend.controls?.keys ?? {}).sort()).toEqual([' ', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'a', 'd', 's', 'w']);
    expect(limboBend.controls?.touch?.left?.channel).toBe('lean');
    expect(limboBend.controls?.touch?.right?.step).toBe(0.25);
    expect(limboBend.controls?.touch?.up?.channel).toBe('up');
    expect(Object.keys(limboBend.strings).sort()).toEqual(['de', 'en', 'es', 'fr', 'tr']);
  });
});

describe('the words', () => {
  it('every language has every key, follows the copy rules, and keeps the same {variables}', () => {
    const keys = Object.keys(LB_STRINGS.en);
    for (const lang of ['en', 'tr', 'de', 'es', 'fr'] as const) {
      expect(Object.keys(LB_STRINGS[lang]).sort(), lang).toEqual(keys.slice().sort());
      for (const k of keys) {
        const text = LB_STRINGS[lang][k] as string;
        expect(copyProblems(text), `${lang} ${k}`).toEqual([]);
        const vars = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();
        expect(vars(text), `${lang} ${k} variables`).toEqual(vars(LB_STRINGS.en[k] as string));
        if (k.startsWith('lb.prompt.')) expect(text.replace(/­/g, '').length, `${lang} ${k}`).toBeLessThanOrEqual(14);
      }
    }
  });

  it('the English lines for the miss codes the game can give are the shell\'s own', () => {
    for (const [k, v] of Object.entries(MISS_EN)) expect(stringTables.en[k], k).toBe(v);
  });
});

describe('the game on the contract', () => {
  it('writes each HUD slot once, with the English words when the shell has none, and only when something changed', async () => {
    const r = await rig();
    r.game.render(0);
    r.game.render(0);
    expect(r.ctx.hudLog.map(([s]) => s).sort()).toEqual(['combo', 'hint', 'prompt', 'score', 'timer']);
    const prompt = r.ctx.last['prompt'] as { icon: string; text: string; progress?: number };
    expect(prompt.icon).toBe('sideBend');
    expect(['Left', 'Right', 'Up, left', 'Up, right']).toContain(prompt.text);
    expect(r.ctx.last['timer']).toBe(24);
    expect(r.ctx.last['score']).toBe(0);
    expect(r.ctx.last['hint']).toBe('');
  });

  it('takes the words from the shell when it has them', async () => {
    const r = await rig({ t: (k) => (k === 'lb.prompt.left' ? 'Sola' : k === 'lb.prompt.right' ? 'Sağa' : k === 'lb.prompt.leftUp' ? 'Yukarı, sola' : k === 'lb.prompt.rightUp' ? 'Yukarı, sağa' : k) });
    r.game.render(0);
    expect(['Sola', 'Sağa', 'Yukarı, sola', 'Yukarı, sağa']).toContain((r.ctx.last['prompt'] as { text: string }).text);
  });

  it('the command names the side of the next gate, says "up" for a tall one, and its progress grows as the gate comes', async () => {
    const r = await rig({ difficulty: 'hard', timing: MED });
    const seen: { text: string; progress: number; target: number; tall: boolean }[] = [];
    const bot = limboBot(sim(r).plan, { mode: 'perfect' });
    for (let k = 1; k < 1300; k++) {
      const at = bot.at(k);
      r.game.step(FIXED_DT, inputFrame(k, { ...at.ch }, [], { source: 'pose' }));
      if (k % 5 === 0) {
        r.game.render(0);
        const next = sim(r).nextGate(0);
        const p = r.ctx.last['prompt'] as { text: string; progress?: number };
        if (next && sim(r).segment.kind === 'work') seen.push({ text: p.text, progress: p.progress ?? -1, target: next.target, tall: next.tall });
      }
    }
    expect(seen.length).toBeGreaterThan(50);
    for (const s of seen) {
      const word = s.target < 0 ? (s.tall ? 'Up, left' : 'Left') : (s.tall ? 'Up, right' : 'Right');
      expect(s.text).toBe(word);
      expect(s.progress).toBeGreaterThanOrEqual(0);
      expect(s.progress).toBeLessThanOrEqual(1);
    }
    expect(seen.some((s) => s.tall)).toBe(true);
    expect(Math.max(...seen.map((s) => s.progress))).toBeGreaterThan(0.7);
  });

  it('a perfect player scores, the streak counts, the sounds are the lock and the pass and the set, and the set is announced with its tolerance', async () => {
    const r = await rig();
    play(r, [limboBot(sim(r).plan, { mode: 'perfect' })], { steps: 700 });
    expect(Number(r.ctx.last['score'])).toBeGreaterThan(100);
    expect(Number(r.ctx.last['combo'])).toBeGreaterThanOrEqual(2);
    for (const s of ['good', 'go']) expect(r.ctx.played, s).toContain(s);
    expect(r.ctx.played.some((s) => s === 'pass' || s === 'perfect')).toBe(true);
    expect(r.ctx.announced[0]).toBe('Set 1 of 1. Lean to the tilt of each gate, within 7 degrees.');
  });

  it('a missed gate sounds the miss and says why on the reason strip, in the shell\'s words, then takes it down after a moment', async () => {
    const r = await rig({ t: (k) => (k === 'miss.bend_more' ? 'Bend further' : k) });
    const idle = limboBot(sim(r).plan, { mode: 'idle' });
    const hints: string[] = [];
    let k = 0;
    while (k < 1200) {
      k++;
      r.game.step(FIXED_DT, inputFrame(k, { ...idle.at(k).ch }, [], { source: 'pose' }));
      if (k % 2 === 0) { r.game.render(0); hints.push(String(r.ctx.last['hint'])); }
    }
    expect(r.ctx.played).toContain('miss');
    expect(hints).toContain('Bend further');
    expect(hints[0]).toBe('');
    // the strip is empty again before the next miss: it is not on all the time
    expect(hints.filter((h) => h === '').length).toBeGreaterThan(hints.filter((h) => h !== '').length);
  });

  it('a rest says "Rest", then "Ready" for its last seconds; the outro is announced with the number of gates passed', async () => {
    const r = await rig({ timing: MED });
    const bot = limboBot(sim(r).plan, { mode: 'perfect' });
    const texts = new Set<string>();
    let k = 0;
    while (sim(r).phase === 'running' && k < 20000) {
      k++;
      const at = bot.at(k);
      r.game.step(FIXED_DT, inputFrame(k, { ...at.ch }, [], { source: 'pose' }));
      if (k % 6 === 0) { r.game.render(0); texts.add((r.ctx.last['prompt'] as { text: string }).text); }
    }
    for (const w of ['Rest', 'Ready', 'Finale']) expect([...texts], w).toContain(w);
    expect(r.ctx.announced.some((a) => /^Rest\. Next is set 2 of 2\.$/.test(a))).toBe(true);
    expect(r.ctx.announced.some((a) => /^Finale\. You passed \d+ gates\.$/.test(a))).toBe(true);
    expect(r.ctx.played).toContain('win');
  });

  it('seated and quiet play need the same detector, and the prompt words do not change', async () => {
    for (const v of [{ seated: true, silent: false }, { seated: false, silent: true }, { seated: false, silent: false }]) {
      const r = await rig(v);
      expect(r.manifest.detectors).toEqual([{ id: 'sideBend' }]);
      r.game.render(0);
      expect((r.ctx.last['prompt'] as { icon: string }).icon).toBe('sideBend');
    }
    expect(lbDetectors({ seated: true, silent: true })).toEqual([{ id: 'sideBend' }]);
  });

  it('snapshot and restore give the same continuation, also in a new game that was only init-ed, in the middle of a gate', async () => {
    const a = await rig({ seed: 9, timing: MED });
    const bot = limboBot(sim(a).plan, { mode: 'sloppy' });
    const g = sim(a).plan.gates[4];
    const first = play(a, [bot], { steps: (g?.arriveK ?? 900) - 20 });
    const snap = JSON.parse(JSON.stringify(a.game.snapshot())) as unknown;
    play(a, [bot], { from: first.k });
    const b = await rig({ seed: 77, timing: MED });
    b.game.restore(snap);
    play(b, [bot], { from: first.k });
    expect(b.game.summary()).toEqual(a.game.summary());
    const c = createLimboBendGame(fresh(), { timing: SHORT });
    await c.init(testContext());
    c.restore(snap);
    expect(c.summary().score).toBeGreaterThanOrEqual(0);
    expect(() => c.restore({ v: 9 })).toThrow();
  });

  it('is pure where the contract says: step() makes no sound, no HUD write and no drawing; render() does', async () => {
    const r = await rig();
    const bot = limboBot(sim(r).plan, { mode: 'perfect' });
    for (let k = 1; k <= 500; k++) { const at = bot.at(k); r.game.step(FIXED_DT, inputFrame(k, { ...at.ch }, [], { source: 'pose' })); }
    expect(r.ctx.played).toEqual([]);
    expect(r.ctx.hudLog).toEqual([]);
    r.game.render(0);
    expect(r.ctx.played.length).toBeGreaterThan(0);
  });

  it('refuses to step before start, and does nothing after dispose', async () => {
    const g = createLimboBendGame(fresh());
    await expect(g.init(testContext())).resolves.toBeUndefined();
    expect(() => g.step(FIXED_DT, inputFrame(1))).toThrow();
    g.start({ seed: 1, difficulty: 'easy', seated: false, mode: 'solo', profile: null });
    g.dispose();
    expect(() => g.render(0)).not.toThrow();
  });

  it('the simulation files are pure (no clock, no Math.random, no DOM); only the view and the host touch the canvas', () => {
    for (const f of ['limbo.ts', 'plan.ts', 'limbo-game.ts']) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(src, f).not.toMatch(/Math\.random|performance\.now|Date\.now|document\.|window\.|requestAnimationFrame/);
    }
  });
});

describe('two players on one camera', () => {
  it('the HUD gets a score and a reason per player and no solo slots; the command and the clock are shared', async () => {
    const kit = testKitDuo(1280, 800);
    const r = await rig({ players: 2, scene2d: kit.kit });
    play(r, [limboBot(sim(r).plan, { mode: 'perfect', lane: 0 }), limboBot(sim(r).plan, { mode: 'sloppy', lane: 1 })], { steps: 900 });
    expect(r.ctx.hudLog.map(([s]) => s).filter((s) => ['score', 'combo', 'hint'].includes(s))).toEqual([]);
    expect(r.ctx.duoLog.some(([p, s]) => p === 1 && s === 'score')).toBe(true);
    expect(r.ctx.duoLog.some(([p, s]) => p === 2 && s === 'hint')).toBe(true);
    expect(Number(r.ctx.last['score1'])).toBeGreaterThan(0);
    expect((r.ctx.last['prompt'] as { text: string }).text).toBe('Bend');
    const s = r.game.summary();
    expect(s.players?.[1]?.score).toBeGreaterThan(0);
    expect(nonFiniteCalls(kit.canvas.ctx)).toEqual([]);
  });

  it('two exact players make team passes: the sound of the star and nothing is lost', async () => {
    const r = await rig({ players: 2 });
    play(r, [limboBot(sim(r).plan, { mode: 'perfect', lane: 0 }), limboBot(sim(r).plan, { mode: 'perfect', lane: 1 })], { steps: 800 });
    expect(r.ctx.played).toContain('star');
    expect(sim(r).summary().players?.[2]?.score).toBeGreaterThan(0);
  });

  it('a HUD that has no player plates shows Player 1 on the plain slots, and Player 2 nowhere', async () => {
    const g = createLimboBendGame(fresh(), { timing: SHORT });
    const ctx = testContext();
    await g.init(ctx);
    g.start({ seed: 1, difficulty: 'normal', seated: false, mode: 'local2', profile: null });
    g.step(FIXED_DT, duoFrame(1, {}, {}));
    g.render(0);
    expect(ctx.hudLog.map(([s]) => s)).toContain('timer');
  });
});

describe('on the HUD of the shell (it has plates per player in every run)', () => {
  it('a one-player run still writes the plain score, combo and reason', async () => {
    const manifest = fresh();
    const ctx = testContext({ seed: 3, duo: true });
    const game = createLimboBendGame(manifest, { timing: SHORT });
    await game.init(ctx);
    game.start({ seed: 3, difficulty: 'normal', seated: false, mode: 'solo', profile: null });
    game.step(FIXED_DT, inputFrame(1, {}, [], { source: 'pose' }));
    game.render(0);
    const slots = ctx.hudLog.map(([s]) => s);
    for (const s of ['score', 'combo', 'hint', 'timer', 'prompt']) expect(slots, s).toContain(s);
    expect(ctx.duoLog).toEqual([]);
  });
});

describe('the view', () => {
  const corners: PipPlacement[] = ['bottom-left', 'bottom-right', 'top-left', 'top-right', 'hidden'];

  it.each(BREAKPOINTS.map((b) => [b.id, b.w, b.h] as const))('%s: draws a whole run in every corner of the self view with finite numbers, and keeps its avatar out from under the self view', async (_id, w, h) => {
    for (const corner of corners) {
      const t = testKit(w, h, { corner });
      const r = await rig({ scene2d: t.kit, timing: { sets: 1, workS: 14, finaleS: 2 } });
      play(r, [limboBot(sim(r).plan, { mode: 'perfect' })], { renderEvery: 3 });
      expect(sim(r).phase, `${corner}`).toBe('complete');
      expect(nonFiniteCalls(t.canvas.ctx), `${corner}`).toEqual([]);
      expect(t.canvas.ctx.count('fillRect')).toBeGreaterThan(150);
      expect(t.canvas.ctx.count('strokeRect')).toBeGreaterThan(10);
      expect(t.kit.stats().particleCapacity).toBeGreaterThan(0);
      const play_ = t.kit.rects.play;
      const L = lbLayout({ w, h, play: play_, pip: t.kit.rects.pip, lanes: null }, 1);
      expect(L.zones).toHaveLength(1);
      for (const z of L.zones) {
        if (t.kit.rects.pip && corner !== 'hidden') {
          const p = t.kit.rects.pip;
          const hit = z.keep.x < p.x + p.w && p.x < z.keep.x + z.keep.w && z.keep.y < p.y + p.h && p.y < z.keep.y + z.keep.h;
          expect(hit, `avatar under the self view at ${corner} ${w}x${h}`).toBe(false);
        }
        expect(z.keep.x).toBeGreaterThanOrEqual(play_.x - 1);
        expect(z.keep.x + z.keep.w).toBeLessThanOrEqual(play_.x + play_.w + 1);
        expect(z.keep.y).toBeGreaterThanOrEqual(play_.y - 1);
        expect(z.keep.y + z.keep.h).toBeLessThanOrEqual(h + 1);
        expect(z.T).toBeGreaterThan(14);
      }
      r.game.dispose();
    }
  });

  it('two players: one avatar and one corridor in each lane, side by side, on the four big screens', async () => {
    for (const bp of BREAKPOINTS.filter((b) => b.w >= 1000 && b.w > b.h)) {
      const t = testKitDuo(bp.w, bp.h);
      expect(t.kit.rects.lanes).not.toBeNull();
      const r = await rig({ players: 2, scene2d: t.kit, timing: { sets: 1, workS: 14, finaleS: 2 } });
      play(r, [limboBot(sim(r).plan, { mode: 'perfect', lane: 0 }), limboBot(sim(r).plan, { mode: 'sloppy', lane: 1 })], { renderEvery: 3 });
      expect(nonFiniteCalls(t.canvas.ctx), bp.id).toEqual([]);
      const L = lbLayout({ w: bp.w, h: bp.h, play: t.kit.rects.play, pip: t.kit.rects.pip, lanes: t.kit.rects.lanes ?? null }, 2);
      expect(L.zones).toHaveLength(2);
      const [a, b] = L.zones as [typeof L.zones[0], typeof L.zones[0]];
      expect(a.hipX).toBeLessThan(b.hipX);
      expect(a.area.x + a.area.w).toBeLessThanOrEqual(b.area.x + 1);
      for (const z of L.zones) {
        expect(z.keep.x).toBeGreaterThanOrEqual(z.area.x - 1);
        expect(z.keep.x + z.keep.w).toBeLessThanOrEqual(z.area.x + z.area.w + 1);
        const p = t.kit.rects.pip;
        if (p) expect(z.keep.y + z.keep.h <= p.y + 1 || z.keep.x + z.keep.w <= p.x + 1 || p.x + p.w <= z.keep.x + 1, `${bp.id} under the shared self view`).toBe(true);
      }
      r.game.dispose();
    }
  });

  it('a new run starts the view afresh (no spark of the last run flies on), and dispose frees it', async () => {
    const t = testKit(390, 844);
    const r = await rig({ scene2d: t.kit });
    play(r, [limboBot(sim(r).plan, { mode: 'perfect' })], { steps: 700 });
    r.game.start({ seed: 1, difficulty: 'normal', seated: false, mode: 'solo', profile: null });
    expect(t.kit.particles.alive).toBe(0);
    r.game.dispose();
    expect(() => r.game.render(0)).not.toThrow();
  });

  it('runs with no scene at all (HUD only) and with reduced motion', async () => {
    const r = await rig();
    play(r, [limboBot(sim(r).plan, { mode: 'perfect' })], { steps: 300 });
    expect(r.ctx.hudLog.length).toBeGreaterThan(0);
    const t = testKit(390, 844);
    const ctx = testContext({ scene2d: t.kit, flags: { reducedMotion: true } });
    const g = createLimboBendGame(fresh(), { timing: MED });
    await g.init(ctx);
    g.start({ seed: 2, difficulty: 'easy', seated: false, mode: 'solo', profile: null });
    const bot = limboBot((g.sim as LimboSim).plan, { mode: 'sloppy' });
    for (let k = 1; k <= 1500; k++) { const at = bot.at(k); g.step(FIXED_DT, inputFrame(k, { ...at.ch }, [], { source: 'pose' })); if (k % 3 === 0) g.render(0.3); }
    expect(nonFiniteCalls(t.canvas.ctx)).toEqual([]);
  });

  it('the avatar leans with the body: the figure is drawn at another angle when the player leans (the strokes differ between frames)', async () => {
    const t = testKit(390, 844);
    const r = await rig({ scene2d: t.kit, timing: MED });
    const bot = limboBot(sim(r).plan, { mode: 'perfect' });
    play(r, [bot], { steps: 200 });
    const before = t.canvas.ctx.count('stroke');
    play(r, [bot], { from: 200, steps: 400 });
    expect(t.canvas.ctx.count('stroke')).toBeGreaterThan(before);
    expect(nonFiniteCalls(t.canvas.ctx)).toEqual([]);
  });
});

/** A session whose game is kept, so a test can read what a player would see on the screen. */
function sessionOf(timing: Partial<GpTiming>, o: Parameters<typeof clockedSession>[1] = {}): { c: ReturnType<typeof clockedSession>; sim: () => LimboSim } {
  const base = limboBendModule(fresh(), { timing });
  let made: ReturnType<typeof createLimboBendGame> | null = null;
  const mod: GameModule = { ...base, create: () => { made = base.create() as ReturnType<typeof createLimboBendGame>; return made; } };
  const c = clockedSession({ 'limbo-bend': mod }, o);
  return { c, sim: () => (made as unknown as { sim: LimboSim }).sim };
}

describe('a whole run through the Session', () => {
  it('keyboard: the arrows turn the lever to the tilt of each gate, Up lifts the hands for a tall one, the summary is the game\'s and the camera is never asked for', async () => {
    const { c, sim: simOf } = sessionOf({ sets: 1, workS: 24, finaleS: 2 });
    let over: { score: number; reps?: number; log: unknown[]; seconds: number } | null = null;
    c.session.on('over', (s) => { over = s; });
    await c.session.start('limbo-bend', { mode: 'solo', difficulty: 'easy', input: 'keyboard', seated: false });
    expect(c.until('running', { maxMs: 6000 })).toBe(true);
    const down = new Set<string>();
    const press = (key: string): void => { if (down.has(key)) return; down.add(key); c.keys.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key, repeat: false, metaKey: false, ctrlKey: false, altKey: false })); };
    const release = (key: string): void => { if (!down.has(key)) return; down.delete(key); c.keys.dispatchEvent(Object.assign(new Event('keyup', { cancelable: true }), { key, repeat: false, metaKey: false, ctrlKey: false, altKey: false })); };
    c.until('results', {
      each: () => {
        if (c.session.state !== 'running') return;
        const s = simOf();
        const next = s.nextGate(0);
        const me = s.playerStates[0];
        // a player looks at the next gate once it is in view and turns the lever towards its tilt
        const want = next && next.arriveK - s.k < 150 ? next.target : 0;
        const have = me?.theta ?? 0;
        const key = Math.abs(want - have) > 1.2 ? (want > have ? 'ArrowRight' : 'ArrowLeft') : null;
        if (key !== 'ArrowRight') release('ArrowRight');
        if (key !== 'ArrowLeft') release('ArrowLeft');
        if (key) press(key);
        if (next?.tall && next.arriveK - s.k < 150) press('ArrowUp'); else release('ArrowUp');
      },
    });
    expect(c.session.state).toBe('results');
    const s = over as unknown as { score: number; reps: number; log: unknown[]; seconds: number };
    expect(s.reps).toBeGreaterThan(5);
    expect(s.score).toBeGreaterThan(500);
    expect(s.seconds).toBeGreaterThan(25);
    expect(c.hudWrites.some(([slot]) => slot === 'prompt')).toBe(true);
    expect(c.played).toContain('good');
  });

  it('the variant reaches the movement engine: every way of playing asks for the side bend detector', async () => {
    const seen: unknown[] = [];
    for (const v of [{ seated: false, silent: false }, { seated: true, silent: false }, { seated: false, silent: true }]) {
      const mod = limboBendModule(fresh());
      const used: unknown[] = [];
      const c = clockedSession({ 'limbo-bend': mod }, {
        camera: fakeCamera(), pose: fakePose(),
        flags: () => ({ reducedMotion: false, silent: v.silent }),
        feed: (fo) => { const f = createPoseFeed(fo); const use = f.use.bind(f); f.use = (specs) => { used.push(specs); use(specs); }; return f; },
      });
      await c.session.start('limbo-bend', { mode: 'solo', difficulty: 'normal', input: 'camera', seated: v.seated });
      expect(c.session.state).toBe('calibrating');
      seen.push(used[0]);
      c.session.quit();
    }
    expect(seen).toEqual([[{ id: 'sideBend' }], [{ id: 'sideBend' }], [{ id: 'sideBend' }]]);
  });
});
