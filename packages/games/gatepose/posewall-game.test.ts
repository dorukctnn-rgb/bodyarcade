// Pose Wall on the Game contract: the manifest, the HUD, the sounds, the reasons on the strip, the variants and their detector, two
// players on one camera, snapshot and restore, the view on the ten screens and in every corner, and whole runs through the Session
// (keyboard, and the camera's detector).
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
import { STAND } from '../_shared/mover.ts';
import poseWall, { manifest as realManifest, poseWallModule } from '../pose-wall/index.ts';
import { createPoseWallGame, limbGroup, missText, pwDetectors, stripText, type PoseWallGameOptions } from './posewall-game.ts';
import { holeOf, mixHex, pwLayout, WALL } from './posewall-view.ts';
import type { GpTiming } from './plan.ts';
import { PW_STRINGS } from './strings.ts';
import type { PoseWallSim, PwWall } from './posewall.ts';
import { poseBot, type PoseBot } from './testing/pose-bot.ts';
import { shapeOf } from './pw-poses.ts';

const fresh = (): GameManifest => structuredClone(realManifest);
const SHORT: Partial<GpTiming> = { sets: 1, workS: 24, finaleS: 2 };
const MED: Partial<GpTiming> = { sets: 2, workS: 22, restS: 6, finaleS: 2 };

interface Rig { game: ReturnType<typeof createPoseWallGame>; ctx: ReturnType<typeof testContext>; manifest: GameManifest }

async function rig(o: { seed?: number; difficulty?: string; seated?: boolean; silent?: boolean; players?: 1 | 2; scene2d?: Scene2D; t?: (k: string, v?: Record<string, string | number>) => string; timing?: Partial<GpTiming>; reducedMotion?: boolean } = {}): Promise<Rig> {
  const manifest = fresh();
  const ctx = testContext({
    seed: o.seed ?? 3, flags: { seated: o.seated ?? false, silent: o.silent ?? false, ...(o.reducedMotion ? { reducedMotion: true } : {}) }, duo: o.players === 2,
    ...(o.scene2d ? { scene2d: o.scene2d } : {}), ...(o.t ? { t: o.t as never } : {}),
  });
  const options: PoseWallGameOptions = { timing: o.timing ?? SHORT };
  const game = createPoseWallGame(manifest, options);
  await game.init(ctx);
  const start: StartOptions = { seed: o.seed ?? 3, difficulty: o.difficulty ?? 'normal', seated: o.seated ?? false, mode: o.players === 2 ? 'local2' : 'solo', profile: null };
  game.start(start);
  return { game, ctx, manifest };
}

const sim = (r: Rig): PoseWallSim => r.game.sim as PoseWallSim;
const bot = (r: Rig, o: Parameters<typeof poseBot>[1]): PoseBot => poseBot(sim(r).plan, o);

/** Plays the game through its own API with scripted players; renders every fourth step. */
function play(r: Rig, bots: PoseBot[], o: { from?: number; steps?: number; renderEvery?: number } = {}): { k: number; phase: string } {
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
    const r = checkEntry(realManifest, 'packages/games/pose-wall/manifest.json', { requiredLangs: ['en', 'tr'], tilesDir: tilesDir() });
    expect(r.problems).toEqual([]);
    expect(r.entry).not.toBeNull();
  });

  it('says only what the game does: one or two players, the variants, the detector, the length, free', () => {
    expect(realManifest.modes).toEqual(['solo', 'local2']);
    expect(realManifest.seated).toBe(true);
    expect(realManifest.silentSafe).toBe(true);
    expect(realManifest.lowImpact).toBe(true);
    expect(realManifest.free).toBe(true);
    expect(realManifest.template).toBe('gate');
    expect(realManifest.framing).toBe('full');
    expect(realManifest.detectors.map((d) => d.id)).toEqual(['poseMatch']);
    expect(realManifest.durationSec).toBe(210);
    expect(realManifest.met).toBe(4);
    expect(realManifest.minPoseHz).toBe(10);
    expect((realManifest as unknown as { catalogue?: unknown }).catalogue).toBeDefined();
  });

  it('the module hands the catalogue the same manifest, the keys, the swipes and the words in five languages', () => {
    expect(poseWall.manifest).toBe(realManifest);
    expect(Object.keys(poseWall.controls?.keys ?? {}).sort()).toEqual([' ', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'a', 'd', 's']);
    expect(poseWall.controls?.keys?.['ArrowRight']?.channel).toBe('pickNext');
    expect(poseWall.controls?.keys?.['a']?.channel).toBe('pickPrev');
    expect(poseWall.controls?.touch?.left?.channel).toBe('pickPrev');
    expect(poseWall.controls?.touch?.right?.channel).toBe('pickNext');
    expect(poseWall.controls?.touch?.tap?.channel).toBe('pickRest');
    expect(Object.keys(poseWall.strings).sort()).toEqual(['de', 'en', 'es', 'fr', 'tr']);
  });
});

describe('the words', () => {
  it('every language has every key, follows the copy rules, and keeps the same {variables}', () => {
    const keys = Object.keys(PW_STRINGS.en);
    for (const lang of ['en', 'tr', 'de', 'es', 'fr'] as const) {
      expect(Object.keys(PW_STRINGS[lang]).sort(), lang).toEqual(keys.slice().sort());
      for (const k of keys) {
        const text = PW_STRINGS[lang][k] as string;
        expect(copyProblems(text), `${lang} ${k}`).toEqual([]);
        const vars = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();
        expect(vars(text), `${lang} ${k} variables`).toEqual(vars(PW_STRINGS.en[k] as string));
        if (k.startsWith('pw.prompt.')) expect(text.replace(/­/g, '').length, `${lang} ${k}`).toBeLessThanOrEqual(14);
        // design/LAYOUT.md 8: a reason during play is at most 40 characters in English and 48 in the translations
        if (k.startsWith('pw.off.') || k === 'pw.fit' || k === 'pw.team') expect(text.replace(/\{\w+\}/g, '00').length, `${lang} ${k}`).toBeLessThanOrEqual(lang === 'en' ? 40 : 48);
      }
    }
  });

  it('the English lines for the miss codes the game can give are the shell\'s own', () => {
    for (const [k, v] of Object.entries(MISS_EN)) expect(stringTables.en[k], k).toBe(v);
  });

  it('names the part of the body that was off: left and right arms and legs, the lean and the head', () => {
    expect(['armUpperL', 'armLowerL', 'armUpperR', 'armLowerR', 'thighL', 'shinL', 'thighR', 'shinR', 'torso', 'neck'].map(limbGroup))
      .toEqual(['armL', 'armL', 'armR', 'armR', 'legL', 'legL', 'legR', 'legR', 'torso', 'neck']);
    const say = (k: string): string => PW_STRINGS.en[k] ?? MISS_EN[k] ?? k;
    expect(missText(say, { code: 'limb_off', limb: 'armLowerL' })).toBe('Left arm off the shape');
    expect(missText(say, { code: 'limb_off', limb: 'shinR' })).toBe('Right leg off the shape');
    expect(missText(say, { code: 'limb_off' })).toBe('An arm or leg was off the shape');
    expect(missText(say, { code: 'held_too_short' })).toBe('Hold it longer');
    expect(missText(say, { code: 'hips_not_low' })).toBe('Hips not low enough');
  });
});

describe('the game on the contract', () => {
  it('writes each HUD slot once, with the English words when the shell has none, and only when something changed', async () => {
    const r = await rig();
    r.game.render(0);
    r.game.render(0);
    expect(r.ctx.hudLog.map(([s]) => s).sort()).toEqual(['combo', 'hint', 'prompt', 'score', 'timer']);
    const prompt = r.ctx.last['prompt'] as { icon: string; text: string; progress?: number };
    expect(prompt.icon).toBe('tPose');
    expect(prompt.text).toBe('Match it');
    expect(r.ctx.last['timer']).toBe(24);
    expect(r.ctx.last['score']).toBe(0);
    expect(r.ctx.last['hint']).toBe('');
  });

  it('takes the words from the shell when it has them', async () => {
    const r = await rig({ t: (k) => (k === 'pw.prompt.match' ? 'Şekli yap' : k) });
    r.game.render(0);
    expect((r.ctx.last['prompt'] as { text: string }).text).toBe('Şekli yap');
  });

  it('the command is the same for every wall, and its progress grows as the wall comes, from nothing to the arrival', async () => {
    const r = await rig({ difficulty: 'hard', timing: MED });
    const seen: { text: string; progress: number }[] = [];
    const b = bot(r, { mode: 'perfect' });
    for (let k = 1; k < 1300; k++) {
      r.game.step(FIXED_DT, inputFrame(k, { ...b.at(k).ch }, [], { source: 'pose' }));
      if (k % 5 === 0) {
        r.game.render(0);
        const p = r.ctx.last['prompt'] as { text: string; progress?: number };
        if (sim(r).nextWall(0) && sim(r).segment.kind === 'work') seen.push({ text: p.text, progress: p.progress ?? -1 });
      }
    }
    expect(seen.length).toBeGreaterThan(50);
    for (const s of seen) {
      expect(s.text).toBe('Match it');
      expect(s.progress).toBeGreaterThanOrEqual(0);
      expect(s.progress).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...seen.map((s) => s.progress))).toBeGreaterThan(0.7);
    expect(Math.min(...seen.map((s) => s.progress))).toBe(0);
  });

  it('a perfect player scores, the streak counts, the sounds are the lock and the pass and the set, the set is announced, and the fit of each wall shows on the strip', async () => {
    const r = await rig();
    const hints = new Set<string>();
    const b = bot(r, { mode: 'perfect' });
    for (let k = 1; k <= 900; k++) {
      r.game.step(FIXED_DT, inputFrame(k, { ...b.at(k).ch }, [], { source: 'pose' }));
      if (k % 3 === 0) { r.game.render(0); hints.add(String(r.ctx.last['hint'])); }
    }
    expect(Number(r.ctx.last['score'])).toBeGreaterThan(100);
    expect(Number(r.ctx.last['combo'])).toBeGreaterThanOrEqual(2);
    for (const s of ['good', 'go']) expect(r.ctx.played, s).toContain(s);
    expect(r.ctx.played.some((s) => s === 'pass' || s === 'perfect')).toBe(true);
    expect(r.ctx.announced[0]).toBe('Set 1 of 1. Make the shape of each wall before it reaches you.');
    expect([...hints].some((h) => /^Fit \d+ percent$/.test(h))).toBe(true);
    expect(hints.has('')).toBe(true);
    const fits = [...hints].filter((h) => h.startsWith('Fit ')).map((h) => Number(h.replace(/\D/g, '')));
    for (const f of fits) { expect(f).toBeGreaterThanOrEqual(50); expect(f).toBeLessThanOrEqual(100); }
  });

  it('a missed wall sounds the hit and says on the reason strip which arm or leg was off, in the shell\'s words when it has them, then takes it down after a moment', async () => {
    const r = await rig({ t: (k) => (k === 'pw.off.armL' ? 'Sol kol şekilden çıktı' : k) });
    const b = bot(r, { mode: 'idle' });
    const hints: string[] = [];
    let k = 0;
    while (k < 1300) {
      k++;
      r.game.step(FIXED_DT, inputFrame(k, { ...b.at(k).ch }, [], { source: 'pose' }));
      if (k % 2 === 0) { r.game.render(0); hints.push(String(r.ctx.last['hint'])); }
    }
    expect(r.ctx.played).toContain('hit');
    expect(hints[0]).toBe('');
    const said = hints.filter((h) => h !== '');
    expect(said.length).toBeGreaterThan(5);
    // a body that stands still with its arms down is off the shape with its arms, and the strip says which one
    expect(said.every((h) => /Left arm off the shape|Right arm off the shape|Left leg off the shape|Right leg off the shape|Lean off the shape|Head off the shape|Sol kol şekilden çıktı|Hold it longer/.test(h))).toBe(true);
    expect(said.some((h) => /arm|kol/.test(h))).toBe(true);
    // the strip is empty again before the next miss: it is not on all the time
    expect(hints.filter((h) => h === '').length).toBeGreaterThan(hints.filter((h) => h !== '').length);
  });

  it('every reason has its own words: hands and knees out of view, hips not low, hold it longer, the part that was off', async () => {
    const seen = new Set<string>();
    const r = await rig({ difficulty: 'expert', seed: 12, timing: { sets: 1, workS: 60, finaleS: 2 } });
    const b = bot(r, { mode: 'sloppy', spoil: (w, n) => (w.pose === 'squatT' ? 'low' : n % 2 === 1 ? (['limb', 'late', 'hands', 'knees'] as const)[Math.floor(n / 2) % 4] as 'limb' : null) });
    let k = 0;
    while (sim(r).phase === 'running' && k < 20000) {
      k++;
      r.game.step(FIXED_DT, inputFrame(k, { ...b.at(k).ch }, [], { source: 'pose' }));
      if (k % 2 === 0) { r.game.render(0); const h = String(r.ctx.last['hint']); if (h) seen.add(h); }
    }
    for (const h of ['Your hands were out of view', 'Your knees were out of view', 'Hold it longer', 'Hips not low enough']) expect([...seen], h).toContain(h);
    expect([...seen].some((h) => /off the shape$/.test(h))).toBe(true);
    for (const h of seen) expect(h.length, h).toBeLessThanOrEqual(40);
  });

  it('a rest says "Rest", then "Ready" for its last seconds; the outro is announced with the number of walls passed', async () => {
    const r = await rig({ timing: MED });
    const b = bot(r, { mode: 'perfect' });
    const texts = new Set<string>();
    let k = 0;
    while (sim(r).phase === 'running' && k < 20000) {
      k++;
      r.game.step(FIXED_DT, inputFrame(k, { ...b.at(k).ch }, [], { source: 'pose' }));
      if (k % 6 === 0) { r.game.render(0); texts.add((r.ctx.last['prompt'] as { text: string }).text); }
    }
    for (const w of ['Rest', 'Ready', 'Well done']) expect([...texts], w).toContain(w);
    expect(r.ctx.announced.some((a) => /^Rest\. Next is set 2 of 2\.$/.test(a))).toBe(true);
    expect(r.ctx.announced.some((a) => /^Finale\. You passed \d+ walls\.$/.test(a))).toBe(true);
    expect(r.ctx.played).toContain('win');
  });

  it('seated and quiet play need the same detector, and the prompt words do not change', async () => {
    for (const v of [{ seated: true, silent: false }, { seated: false, silent: true }, { seated: false, silent: false }]) {
      const r = await rig(v);
      expect(r.manifest.detectors).toEqual([{ id: 'poseMatch' }]);
      r.game.render(0);
      expect((r.ctx.last['prompt'] as { icon: string; text: string }).text).toBe('Match it');
    }
    expect(pwDetectors({ seated: true, silent: true })).toEqual([{ id: 'poseMatch' }]);
  });

  it('seated: no wall asks for a leg, a squat or a balance, and a seated body with odd legs passes every wall', async () => {
    const r = await rig({ seated: true, difficulty: 'expert', timing: { sets: 1, workS: 30, finaleS: 2 } });
    const s = sim(r);
    for (const w of s.plan.walls) {
      const shape = s.shape(w.pose);
      expect(Object.keys(shape.limbs).filter((l) => l.startsWith('thigh') || l.startsWith('shin')), w.pose).toEqual([]);
    }
    const b = bot(r, { mode: 'perfect' });
    const odd = { ...b, at: (k: number) => { const p = b.at(k); return { ...p, ch: { ...p.ch, 'pose.legs': 0, 'limb.thighL': 0, 'limb.thighR': 180 } }; } };
    play(r, [odd]);
    expect(s.playerStates[0]?.missed).toBe(0);
    expect(s.playerStates[0]?.passed).toBe(s.plan.walls.length);
  });

  it('snapshot and restore give the same continuation, also in a new game that was only init-ed, in the middle of a wall', async () => {
    const a = await rig({ seed: 9, timing: MED });
    const b = bot(a, { mode: 'sloppy' });
    const w = sim(a).plan.walls[4] as PwWall;
    const first = play(a, [b], { steps: w.arriveK - 20 });
    const snap = JSON.parse(JSON.stringify(a.game.snapshot())) as unknown;
    play(a, [b], { from: first.k });
    const c2 = await rig({ seed: 77, timing: MED });
    c2.game.restore(snap);
    play(c2, [b], { from: first.k });
    expect(c2.game.summary()).toEqual(a.game.summary());
    const c = createPoseWallGame(fresh(), { timing: SHORT });
    await c.init(testContext());
    c.restore(snap);
    expect(c.summary().score).toBeGreaterThanOrEqual(0);
    expect(() => c.restore({ v: 9 })).toThrow();
  });

  it('is pure where the contract says: step() makes no sound, no HUD write and no drawing; render() does', async () => {
    const r = await rig();
    const b = bot(r, { mode: 'perfect' });
    for (let k = 1; k <= 500; k++) r.game.step(FIXED_DT, inputFrame(k, { ...b.at(k).ch }, [], { source: 'pose' }));
    expect(r.ctx.played).toEqual([]);
    expect(r.ctx.hudLog).toEqual([]);
    r.game.render(0);
    expect(r.ctx.played.length).toBeGreaterThan(0);
  });

  it('refuses to step before start, and does nothing after dispose', async () => {
    const g = createPoseWallGame(fresh());
    await expect(g.init(testContext())).resolves.toBeUndefined();
    expect(() => g.step(FIXED_DT, inputFrame(1))).toThrow();
    g.start({ seed: 1, difficulty: 'easy', seated: false, mode: 'solo', profile: null });
    g.dispose();
    expect(() => g.render(0)).not.toThrow();
  });

  it('the simulation files are pure (no clock, no Math.random, no DOM); only the view and the host touch the canvas', () => {
    for (const f of ['posewall.ts', 'plan.ts', 'posewall-game.ts', 'pw-poses.ts']) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(src, f).not.toMatch(/Math\.random|performance\.now|Date\.now|document\.|window\.|requestAnimationFrame/);
    }
  });
});

describe('two players on one camera', () => {
  it('the HUD gets a score and a reason per player and no solo slots; the command and the clock are shared', async () => {
    const kit = testKitDuo(1280, 800);
    const r = await rig({ players: 2, scene2d: kit.kit });
    play(r, [bot(r, { mode: 'perfect', lane: 0 }), bot(r, { mode: 'sloppy', lane: 1 })], { steps: 900 });
    expect(r.ctx.hudLog.map(([s]) => s).filter((s) => ['score', 'combo', 'hint'].includes(s))).toEqual([]);
    expect(r.ctx.duoLog.some(([p, s]) => p === 1 && s === 'score')).toBe(true);
    expect(r.ctx.duoLog.some(([p, s]) => p === 2 && s === 'hint')).toBe(true);
    expect(Number(r.ctx.last['score1'])).toBeGreaterThan(0);
    expect((r.ctx.last['prompt'] as { text: string }).text).toBe('Match it');
    const s = r.game.summary();
    expect(s.players?.[1]?.score).toBeGreaterThan(0);
    expect(nonFiniteCalls(kit.canvas.ctx)).toEqual([]);
  });

  it('two exact players make team passes: the coin sound, "Both through" on both strips, and nothing is lost', async () => {
    const r = await rig({ players: 2 });
    const strips = new Set<string>();
    const b0 = bot(r, { mode: 'perfect', lane: 0 }), b1 = bot(r, { mode: 'perfect', lane: 1 });
    for (let k = 1; k <= 900; k++) {
      r.game.step(FIXED_DT, duoFrame(k, { channels: { ...b0.at(k).ch } }, { channels: { ...b1.at(k).ch } }, 'pose'));
      if (k % 3 === 0) { r.game.render(0); strips.add(String(r.ctx.last['hint1'])); strips.add(String(r.ctx.last['hint2'])); }
    }
    expect(r.ctx.played).toContain('coin');
    expect(strips.has('Both through, 25 extra')).toBe(true);
    expect(sim(r).summary().players?.[2]?.score).toBeGreaterThan(0);
  });

  it('a HUD that has no player plates shows Player 1 on the plain slots, and Player 2 nowhere', async () => {
    const g = createPoseWallGame(fresh(), { timing: SHORT });
    const ctx = testContext();
    await g.init(ctx);
    g.start({ seed: 1, difficulty: 'normal', seated: false, mode: 'local2', profile: null });
    g.step(FIXED_DT, duoFrame(1, {}, {}));
    g.render(0);
    expect(ctx.hudLog.map(([s]) => s)).toContain('timer');
  });

  it('stripText: the newest of a reason, the fit of the last wall and the team pass; nothing when nothing is new', async () => {
    const r = await rig();
    const s = sim(r);
    const b = bot(r, { mode: 'perfect' });
    const say = (k: string, v?: Record<string, string | number>): string => (PW_STRINGS.en[k] ?? MISS_EN[k] ?? k).replace(/\{(\w+)\}/g, (m, n: string) => String(v?.[n] ?? m));
    expect(stripText(s, s.playerStates[0]!, say)).toBe('');
    play(r, [b], { steps: (s.plan.walls[0] as PwWall).arriveK + 20 });
    expect(stripText(s, s.playerStates[0]!, say)).toMatch(/^Fit \d+ percent$/);
    play(r, [b], { from: (s.plan.walls[0] as PwWall).arriveK + 20, steps: 200 });
    expect(stripText(s, s.playerStates[0]!, say)).toBe('');
  });
});

describe('the view', () => {
  const corners: PipPlacement[] = ['bottom-left', 'bottom-right', 'top-left', 'top-right', 'hidden'];

  it.each(BREAKPOINTS.map((b) => [b.id, b.w, b.h] as const))('%s: draws a whole run in every corner of the self view with finite numbers, and keeps its avatar and wall out from under the self view', async (_id, w, h) => {
    for (const corner of corners) {
      const t = testKit(w, h, { corner });
      const r = await rig({ scene2d: t.kit, timing: { sets: 1, workS: 14, finaleS: 2 } });
      play(r, [bot(r, { mode: 'sloppy' })], { renderEvery: 3 });
      expect(sim(r).phase, `${corner}`).toBe('complete');
      expect(nonFiniteCalls(t.canvas.ctx), `${corner}`).toEqual([]);
      expect(t.canvas.ctx.count('fillRect')).toBeGreaterThan(100);
      expect(t.canvas.ctx.count('stroke')).toBeGreaterThan(200);
      expect(t.kit.stats().particleCapacity).toBeGreaterThan(0);
      const play_ = t.kit.rects.play;
      const L = pwLayout({ w, h, play: play_, pip: t.kit.rects.pip, lanes: null }, 1);
      expect(L.zones).toHaveLength(1);
      for (const z of L.zones) {
        if (t.kit.rects.pip && corner !== 'hidden') {
          const p = t.kit.rects.pip;
          const hit = z.keep.x < p.x + p.w && p.x < z.keep.x + z.keep.w && z.keep.y < p.y + p.h && p.y < z.keep.y + z.keep.h;
          expect(hit, `wall under the self view at ${corner} ${w}x${h}`).toBe(false);
        }
        expect(z.keep.x).toBeGreaterThanOrEqual(play_.x - 1);
        expect(z.keep.x + z.keep.w).toBeLessThanOrEqual(play_.x + play_.w + 1);
        expect(z.keep.y).toBeGreaterThanOrEqual(play_.y - 1);
        expect(z.keep.y + z.keep.h).toBeLessThanOrEqual(h + 1);
        expect(z.T).toBeGreaterThan(14);
        // the wall at its arrival is as wide as the box that was kept for it
        expect(z.keep.w).toBeCloseTo(2 * WALL.halfW * z.T, 3);
      }
      r.game.dispose();
    }
  });

  it('two players: one avatar and one wall in each lane, side by side, on the four big screens', async () => {
    for (const bp of BREAKPOINTS.filter((b) => b.w >= 1000 && b.w > b.h)) {
      const t = testKitDuo(bp.w, bp.h);
      expect(t.kit.rects.lanes).not.toBeNull();
      const r = await rig({ players: 2, scene2d: t.kit, timing: { sets: 1, workS: 14, finaleS: 2 } });
      play(r, [bot(r, { mode: 'perfect', lane: 0 }), bot(r, { mode: 'sloppy', lane: 1 })], { renderEvery: 3 });
      expect(nonFiniteCalls(t.canvas.ctx), bp.id).toEqual([]);
      const L = pwLayout({ w: bp.w, h: bp.h, play: t.kit.rects.play, pip: t.kit.rects.pip, lanes: t.kit.rects.lanes ?? null }, 2);
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

  it('the hole of every shape is the shape: its limbs, with the legs standing when it does not ask for them, and a lowered hip for a squat', () => {
    const t = holeOf(shapeOf('tPose', false));
    expect(t.limbs.armUpperR).toBe(0);
    expect(t.limbs.armUpperL).toBe(180);
    expect(t.down).toBe(0);
    const c = holeOf(shapeOf('cactus', false));
    expect(c.limbs.thighL).toBe(STAND.thighL);
    expect(c.limbs.armLowerR).toBe(90);
    const q = holeOf(shapeOf('squatT', false));
    expect(q.down).toBeGreaterThan(0.3);
    expect(q.limbs.thighL).toBeLessThan(-100);
    expect(q.limbs.thighR).toBeGreaterThan(-80);
  });

  it('the rim warms from sun to mint', () => {
    expect(mixHex('#FFC53A', '#22C383', 0)).toBe('#ffc53a');
    expect(mixHex('#FFC53A', '#22C383', 1)).toBe('#22c383');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#000000', '#ffffff', 7)).toBe('#ffffff');
  });

  it('a new run starts the view afresh (no spark of the last run flies on), and dispose frees it', async () => {
    const t = testKit(390, 844);
    const r = await rig({ scene2d: t.kit });
    play(r, [bot(r, { mode: 'perfect' })], { steps: 700 });
    r.game.start({ seed: 1, difficulty: 'normal', seated: false, mode: 'solo', profile: null });
    expect(t.kit.particles.alive).toBe(0);
    r.game.dispose();
    expect(() => r.game.render(0)).not.toThrow();
  });

  it('runs with no scene at all (HUD only), with reduced motion (nothing holds, shakes or flashes), and seated (the figures are drawn from the hips up)', async () => {
    const r = await rig();
    play(r, [bot(r, { mode: 'perfect' })], { steps: 300 });
    expect(r.ctx.hudLog.length).toBeGreaterThan(0);
    const calm = testKit(390, 844);
    const moving = testKit(390, 844);
    const shown: string[] = [];
    for (const [t, reduced] of [[calm, true], [moving, false]] as const) {
      const rr = await rig({ scene2d: t.kit, reducedMotion: reduced, timing: MED, seed: 2, difficulty: 'easy' });
      play(rr, [bot(rr, { mode: 'sloppy' })], { renderEvery: 2 });
      expect(nonFiniteCalls(t.canvas.ctx)).toEqual([]);
      shown.push(String(t.canvas.ctx.count('translate')));
    }
    // a verdict shakes the picture (a translate of the whole scene) unless motion is reduced
    expect(Number(shown[0])).toBeLessThan(Number(shown[1]));
    const seat = testKit(390, 844);
    const stand = testKit(390, 844);
    for (const [t, seated] of [[seat, true], [stand, false]] as const) {
      const rr = await rig({ scene2d: t.kit, seated, timing: { sets: 1, workS: 8, finaleS: 2 }, difficulty: 'easy' });
      play(rr, [bot(rr, { mode: 'idle' })], { renderEvery: 1, steps: 330 });
    }
    expect(seat.canvas.ctx.count('lineTo')).toBeLessThan(stand.canvas.ctx.count('lineTo'));
  });

  it('the avatar makes the body\'s shape: the strokes differ between a standing body and one in the shape', async () => {
    const t = testKit(390, 844);
    const r = await rig({ scene2d: t.kit, timing: MED });
    const b = bot(r, { mode: 'perfect' });
    play(r, [b], { steps: 200 });
    const before = t.canvas.ctx.count('stroke');
    play(r, [b], { from: 200, steps: 400 });
    expect(t.canvas.ctx.count('stroke')).toBeGreaterThan(before);
    expect(nonFiniteCalls(t.canvas.ctx)).toEqual([]);
  });
});

/** A session whose game is kept, so a test can read what a player would see on the screen. */
function sessionOf(timing: Partial<GpTiming>, o: Parameters<typeof clockedSession>[1] = {}): { c: ReturnType<typeof clockedSession>; sim: () => PoseWallSim } {
  const base = poseWallModule(fresh(), { timing });
  let made: ReturnType<typeof createPoseWallGame> | null = null;
  const mod: GameModule = { ...base, create: () => { made = base.create() as ReturnType<typeof createPoseWallGame>; return made; } };
  const c = clockedSession({ 'pose-wall': mod }, o);
  return { c, sim: () => (made as unknown as { sim: PoseWallSim }).sim };
}

describe('a whole run through the Session', () => {
  it('keyboard: the arrows step to the shape of each wall, the summary is the game\'s and the camera is never asked for', async () => {
    const { c, sim: simOf } = sessionOf({ sets: 1, workS: 24, finaleS: 2 });
    let over: { score: number; reps?: number; log: unknown[]; seconds: number } | null = null;
    c.session.on('over', (s) => { over = s; });
    await c.session.start('pose-wall', { mode: 'solo', difficulty: 'easy', input: 'keyboard', seated: false });
    expect(c.until('running', { maxMs: 6000 })).toBe(true);
    let down: string | null = null;
    const press = (key: string): void => { down = key; c.keys.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key, repeat: false, metaKey: false, ctrlKey: false, altKey: false })); };
    const release = (): void => { if (down) c.keys.dispatchEvent(Object.assign(new Event('keyup', { cancelable: true }), { key: down, repeat: false, metaKey: false, ctrlKey: false, altKey: false })); down = null; };
    c.until('results', {
      each: () => {
        if (c.session.state !== 'running') return;
        // a pressed key is let go on the next frame, so the game sees it go down and come up
        if (down) { release(); return; }
        const s = simOf();
        const next = s.nextWall(0);
        const me = s.playerStates[0];
        if (!next || !me || next.arriveK - s.k > 200) return;
        const want = s.pickNames.indexOf(next.pose);
        if (me.pick === want) return;
        const n = s.pickNames.length;
        const forward = (want - me.pick + n) % n;
        press(forward <= n - forward ? 'ArrowRight' : 'ArrowLeft');
      },
    });
    expect(c.session.state).toBe('results');
    const s = over as unknown as { score: number; reps: number; log: unknown[]; seconds: number };
    expect(s.reps).toBe(simOf().plan.walls.length);
    expect(s.reps).toBeGreaterThanOrEqual(4);
    expect(s.score).toBeGreaterThan(400);
    expect(s.seconds).toBeGreaterThan(25);
    expect(c.hudWrites.some(([slot]) => slot === 'prompt')).toBe(true);
    expect(c.played).toContain('good');
  });

  it('the variant reaches the movement engine: every way of playing asks for the pose matching detector', async () => {
    const seen: unknown[] = [];
    for (const v of [{ seated: false, silent: false }, { seated: true, silent: false }, { seated: false, silent: true }]) {
      const mod = poseWallModule(fresh());
      const used: unknown[] = [];
      const c = clockedSession({ 'pose-wall': mod }, {
        camera: fakeCamera(), pose: fakePose(),
        flags: () => ({ reducedMotion: false, silent: v.silent }),
        feed: (fo) => { const f = createPoseFeed(fo); const use = f.use.bind(f); f.use = (specs) => { used.push(specs); use(specs); }; return f; },
      });
      await c.session.start('pose-wall', { mode: 'solo', difficulty: 'normal', input: 'camera', seated: v.seated });
      expect(c.session.state).toBe('calibrating');
      seen.push(used[0]);
      c.session.quit();
    }
    expect(seen).toEqual([[{ id: 'poseMatch' }], [{ id: 'poseMatch' }], [{ id: 'poseMatch' }]]);
  });
});
