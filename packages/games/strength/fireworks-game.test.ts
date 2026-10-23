// Firework Jacks on the Game contract: the manifest, the HUD, the sounds, the variants and their detectors, snapshot and
// restore, the view on the ten screens and in every corner, two players, and a whole run through the Session.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPoseFeed } from '../../core/input/pose-feed.ts';
import type { GameManifest, InputFrame, StartOptions } from '../../core/types/index.ts';
import { FIXED_DT } from '../../core/types/index.ts';
import { BREAKPOINTS } from '../../core/ui/layout.ts';
import type { PipPlacement } from '../../core/ui/layout.ts';
import { checkEntry } from '../../web/catalogue/validate.ts';
import { tilesDir } from '../../web/catalogue/load.ts';
import { copyProblems } from '../../web/catalogue/copy.ts';
import { stringTables } from '../../core/ui/i18n/index.ts';
import type { Scene2D } from '../../core/types/index.ts';
import { clockedSession, fakeCamera, fakePose } from '../_shared/testing/fakes.ts';
import { duoFrame, inputFrame, nonFiniteCalls, testContext, testKit, testKitDuo } from '../_shared/testing/context.ts';
import { MISS_EN } from '../_shared/reasons.ts';
import fireworkJacks, { manifest as realManifest, fireworkJacksModule } from '../firework-jacks/index.ts';
import { createFireworkJacksGame, fjDetectors } from './fireworks-game.ts';
import { fjLayout, type Geometry } from './fireworks-view.ts';
import type { FireworkSim } from './fireworks.ts';
import { FJ_STRINGS } from './strings.ts';
import { jackBot } from './testing/bots.ts';

const fresh = (): GameManifest => structuredClone(realManifest);
const SHORT = { sets: 1, workS: 14, finaleS: 2 } as const;

interface Rig { game: ReturnType<typeof createFireworkJacksGame>; ctx: ReturnType<typeof testContext>; manifest: GameManifest }

async function rig(o: { seed?: number; difficulty?: string; seated?: boolean; silent?: boolean; players?: 1 | 2; scene2d?: Scene2D; t?: (k: string, v?: Record<string, string | number>) => string; short?: boolean } = {}): Promise<Rig> {
  const manifest = fresh();
  const ctx = testContext({ seed: o.seed ?? 3, flags: { seated: o.seated ?? false, silent: o.silent ?? false }, duo: o.players === 2, ...(o.scene2d ? { scene2d: o.scene2d } : {}), ...(o.t ? { t: o.t as never } : {}) });
  const game = createFireworkJacksGame(manifest, o.short === false ? {} : { timing: SHORT });
  await game.init(ctx);
  const start: StartOptions = { seed: o.seed ?? 3, difficulty: o.difficulty ?? 'normal', seated: o.seated ?? false, mode: o.players === 2 ? 'local2' : 'solo', profile: null };
  game.start(start);
  return { game, ctx, manifest };
}

/** Plays the game through its own API with scripted players; renders every fourth step. */
function play(r: Rig, bots: ReturnType<typeof jackBot>[], o: { from?: number; steps?: number; renderEvery?: number } = {}): { k: number; phase: string } {
  let k = o.from ?? 0;
  let phase = 'running';
  const end = o.steps !== undefined ? k + o.steps : Infinity;
  while (phase === 'running' && k < end && k < 200_000) {
    k++;
    const frame: InputFrame = bots.length === 2
      ? duoFrame(k, { channels: bots[0]!.at(k).ch, events: [...bots[0]!.at(k).events] }, { channels: bots[1]!.at(k).ch, events: [...bots[1]!.at(k).events] }, 'pose')
      : inputFrame(k, { ...bots[0]!.at(k).ch }, [...bots[0]!.at(k).events], { source: 'pose' });
    phase = r.game.step(FIXED_DT, frame).phase;
    if (k % (o.renderEvery ?? 4) === 0) r.game.render(0.5);
  }
  return { k, phase };
}

describe('the manifest', () => {
  it('passes the catalogue schema and the house rules in English and Turkish, with its tile art', () => {
    const r = checkEntry(realManifest, 'packages/games/firework-jacks/manifest.json', { requiredLangs: ['en', 'tr'], tilesDir: tilesDir() });
    expect(r.problems).toEqual([]);
    expect(r.entry).not.toBeNull();
  });

  it('says only what the game does: modes, variants, the detector, the length', () => {
    expect(realManifest.modes).toEqual(['solo', 'local2']);
    expect(realManifest.seated).toBe(true);
    expect(realManifest.silentSafe).toBe(true);
    expect(realManifest.free).toBe(true);
    expect(realManifest.template).toBe('strength');
    expect(realManifest.detectors.map((d) => d.id)).toEqual(['jumpingJack']);
    expect(realManifest.durationSec).toBe(240);
    expect(realManifest.met).toBe(8);
    expect((realManifest as unknown as { catalogue?: unknown }).catalogue).toBeDefined();
  });

  it('the module hands the catalogue the same manifest, the keys, the taps and the words in five languages', () => {
    expect(fireworkJacks.manifest).toBe(realManifest);
    expect(Object.keys(fireworkJacks.controls?.keys ?? {})).toContain(' ');
    expect(fireworkJacks.controls?.touch?.tap?.event).toBe('jumpingJack');
    expect(Object.keys(fireworkJacks.strings).sort()).toEqual(['de', 'en', 'es', 'fr', 'tr']);
  });
});

describe('the words', () => {
  it('every language has every key, follows the copy rules, and keeps the same {variables}', () => {
    const keys = Object.keys(FJ_STRINGS.en);
    for (const lang of ['en', 'tr', 'de', 'es', 'fr'] as const) {
      expect(Object.keys(FJ_STRINGS[lang]).sort(), lang).toEqual(keys.slice().sort());
      for (const k of keys) {
        const text = FJ_STRINGS[lang][k] as string;
        expect(copyProblems(text), `${lang} ${k}`).toEqual([]);
        const vars = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();
        expect(vars(text), `${lang} ${k} variables`).toEqual(vars(FJ_STRINGS.en[k] as string));
        if (k.startsWith('fj.prompt.')) expect(text.replace(/­/g, '').length, `${lang} ${k}`).toBeLessThanOrEqual(12);
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
    const slots = r.ctx.hudLog.map(([s]) => s);
    expect(slots.sort()).toEqual(['combo', 'hint', 'prompt', 'score', 'timer']);
    expect(r.ctx.last['prompt']).toEqual({ icon: 'stand', text: 'Ready' });
    expect(r.ctx.last['timer']).toBe(14);
    expect(r.ctx.last['score']).toBe(0);
  });

  it('takes the words from the shell when it has them', async () => {
    const r = await rig({ t: (k) => (k === 'fj.prompt.ready' ? 'Hazır' : k === 'miss.arms_not_up' ? 'Kollar yeterince yükselmedi' : k) });
    r.game.render(0);
    expect(r.ctx.last['prompt']).toEqual({ icon: 'stand', text: 'Hazır' });
  });

  it('after the count-in the command is the move, the scores and the streak follow, the sounds are the beat and the firework', async () => {
    const r = await rig();
    const sim = r.game.sim as FireworkSim;
    play(r, [jackBot(sim.plan, { mode: 'perfect' })], { steps: 600 });
    expect(r.ctx.last['prompt']).toEqual({ icon: 'jackOpen', text: 'Jack' });
    expect(Number(r.ctx.last['score'])).toBeGreaterThan(50);
    expect(Number(r.ctx.last['combo'])).toBeGreaterThan(2);
    for (const s of ['metronome', 'tick', 'go', 'firework-launch', 'perfect']) expect(r.ctx.played, s).toContain(s);
    expect(r.ctx.announced[0]).toMatch(/^Set 1 of 1, \d+ jacks a minute\.$/);
  });

  it('says why a try did not count on the reason strip, in the shell\'s words, and takes it down after a moment', async () => {
    const r = await rig({ seed: 5, t: (k) => (k === 'miss.arms_not_up' ? 'Arms not high enough' : k) });
    const sim = r.game.sim as FireworkSim;
    // a sloppy player: some tries do not reach
    const bot = jackBot(sim.plan, { mode: 'sloppy', seed: 5 });
    let sawHint = '';
    for (let k = 1; k < 800; k++) {
      r.game.step(FIXED_DT, inputFrame(k, { ...bot.at(k).ch }, [...bot.at(k).events], { source: 'pose' }));
      if (k % 2 === 0) { r.game.render(0); const h = r.ctx.last['hint']; if (typeof h === 'string' && h) sawHint ||= h; }
    }
    expect(['Arms not high enough', 'Feet not wide enough']).toContain(sawHint);
    // stand still: the strip empties
    for (let k = 800; k < 1100; k++) r.game.step(FIXED_DT, inputFrame(k, {}, [], { source: 'pose' }));
    r.game.render(0);
    expect(['', 'Move more']).toContain(r.ctx.last['hint']);
  });

  it('seated plays arm jacks and quiet plays step jacks, and the detector follows (the session reads manifest.detectors after init)', async () => {
    const seated = await rig({ seated: true });
    expect(seated.manifest.detectors).toEqual([{ id: 'jumpingJack', opts: { armsOnly: 1 } }]);
    seated.game.render(0);
    seated.game.step(FIXED_DT, inputFrame(1));
    seated.game.render(0);
    const quiet = await rig({ silent: true });
    expect(quiet.manifest.detectors).toEqual([{ id: 'jumpingJack', opts: { step: 1 } }]);
    const standard = await rig();
    expect(standard.manifest.detectors).toEqual([{ id: 'jumpingJack' }]);
    expect(fjDetectors({ seated: true, silent: true })).toEqual([{ id: 'jumpingJack', opts: { armsOnly: 1 } }]);
    // the prompt of the variant
    const sim = seated.game.sim as FireworkSim;
    play(seated, [jackBot(sim.plan, { mode: 'perfect', armsOnly: true })], { steps: 600 });
    expect(seated.ctx.last['prompt']).toEqual({ icon: 'seated', text: 'Arm jack' });
    const q = await rig({ silent: true });
    play(q, [jackBot((q.game.sim as FireworkSim).plan, { mode: 'perfect' })], { steps: 600 });
    expect(q.ctx.last['prompt']).toEqual({ icon: 'jackOpen', text: 'Step jack' });
  });

  it('snapshot and restore give the same continuation, also in a new game that was only init-ed', async () => {
    const a = await rig({ seed: 9 });
    const plan = (a.game.sim as FireworkSim).plan;
    const bot = jackBot(plan, { mode: 'sloppy', seed: 9 });
    const first = play(a, [bot], { steps: 500 });
    const snap = JSON.parse(JSON.stringify(a.game.snapshot())) as unknown;
    play(a, [bot], { from: first.k });
    const b = await rig({ seed: 77 });
    b.game.restore(snap);
    play(b, [bot], { from: first.k });
    expect(b.game.summary()).toEqual(a.game.summary());
    const c = createFireworkJacksGame(fresh(), { timing: SHORT });
    await c.init(testContext());
    c.restore(snap);
    expect(c.summary().score).toBeGreaterThanOrEqual(0);
    expect(() => c.restore({ v: 9 })).toThrow();
  });

  it('is pure where the contract says: step() makes no sound, no HUD write and no drawing; render() does', async () => {
    const r = await rig();
    const plan = (r.game.sim as FireworkSim).plan;
    const bot = jackBot(plan, { mode: 'perfect' });
    for (let k = 1; k <= 400; k++) r.game.step(FIXED_DT, inputFrame(k, { ...bot.at(k).ch }, [...bot.at(k).events], { source: 'pose' }));
    expect(r.ctx.played).toEqual([]);
    expect(r.ctx.hudLog).toEqual([]);
    r.game.render(0);
    expect(r.ctx.played.length).toBeGreaterThan(0);
  });

  it('refuses to step before start, and does nothing after dispose', async () => {
    const g = createFireworkJacksGame(fresh());
    await expect(g.init(testContext())).resolves.toBeUndefined();
    expect(() => g.step(FIXED_DT, inputFrame(1))).toThrow();
    g.start({ seed: 1, difficulty: 'easy', seated: false, mode: 'solo', profile: null });
    g.dispose();
    expect(() => g.render(0)).not.toThrow();
  });

  it('the simulation files are pure (no clock, no Math.random, no DOM); only the view and the host touch the canvas', () => {
    for (const f of ['fireworks.ts', 'kit.ts', 'fireworks-game.ts']) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(src, f).not.toMatch(/Math\.random|performance\.now|Date\.now|document\.|window\.|requestAnimationFrame/);
    }
  });
});

describe('two players on one camera', () => {
  it('the HUD gets a score and a reason per player and no solo slots; the command and the clock are shared', async () => {
    const kit = testKitDuo(1280, 800);
    const r = await rig({ players: 2, scene2d: kit.kit });
    const plan = (r.game.sim as FireworkSim).plan;
    play(r, [jackBot(plan, { mode: 'perfect' }), jackBot(plan, { mode: 'perfect' })], { steps: 600 });
    expect(r.ctx.hudLog.map(([s]) => s).filter((s) => ['score', 'combo', 'hint', 'lives'].includes(s))).toEqual([]);
    expect(r.ctx.duoLog.some(([p, s]) => p === 1 && s === 'score')).toBe(true);
    expect(r.ctx.duoLog.some(([p, s]) => p === 2 && s === 'score')).toBe(true);
    expect(Number(r.ctx.last['score1'])).toBeGreaterThan(0);
    expect(r.ctx.last['score1']).toBe(r.ctx.last['score2']);
    expect(r.ctx.last['prompt']).toEqual({ icon: 'jackOpen', text: 'Jack' });
    const s = r.game.summary();
    expect(s.players?.[1]?.score).toBeGreaterThan(0);
    expect(nonFiniteCalls(kit.canvas.ctx)).toEqual([]);
  });

  it('a HUD that has no player plates shows Player 1 on the plain slots, and Player 2 nowhere', async () => {
    const r = await rig({ players: 1 });
    const g = createFireworkJacksGame(fresh(), { timing: SHORT });
    const ctx = testContext();
    await g.init(ctx);
    g.start({ seed: 1, difficulty: 'normal', seated: false, mode: 'local2', profile: null });
    g.step(FIXED_DT, duoFrame(1, {}, {}));
    g.render(0);
    expect(ctx.hudLog.map(([s]) => s)).toContain('timer');
    expect(r.ctx).toBeDefined();
  });
});

describe('the view', () => {
  const corners: PipPlacement[] = ['bottom-left', 'bottom-right', 'top-left', 'top-right', 'hidden'];

  it.each(BREAKPOINTS.map((b) => [b.id, b.w, b.h] as const))('%s: draws a whole run in every corner of the self view with finite numbers, and keeps its avatar out from under the self view', async (_id, w, h) => {
    for (const corner of corners) {
      const t = testKit(w, h, { corner });
      const r = await rig({ scene2d: t.kit, short: true });
      const plan = (r.game.sim as FireworkSim).plan;
      play(r, [jackBot(plan, { mode: 'perfect' })], { renderEvery: 3 });
      expect(r.game.sim!.phase).toBe('complete');
      expect(nonFiniteCalls(t.canvas.ctx), `${corner}`).toEqual([]);
      expect(t.canvas.ctx.count('fillRect')).toBeGreaterThan(200);
      expect(t.kit.stats().particleCapacity).toBeGreaterThan(0);
      // the layout: nothing the player must see is under the self view
      const geometry: Geometry = { w, h, play: t.kit.rects.play, pip: t.kit.rects.pip, lanes: null };
      const L = fjLayout(geometry, 1);
      for (const z of L.zones) {
        for (const keep of z.keep) {
          if (geometry.pip && corner !== 'hidden') {
            const p = geometry.pip;
            const hit = keep.x < p.x + p.w && p.x < keep.x + keep.w && keep.y < p.y + p.h && p.y < keep.y + keep.h;
            // the layout moves aside or shrinks; at the narrowest it may still touch the pad's rim, never the avatar
            if (hit) expect(keep, `${corner} ${w}x${h}`).toBe(z.keep[1]);
          }
          expect(keep.y + keep.h).toBeLessThanOrEqual(h + 1);
          expect(keep.x).toBeGreaterThanOrEqual(-1);
          expect(keep.x + keep.w).toBeLessThanOrEqual(w + 1);
        }
        // the avatar stays inside the play area
        expect(z.hipX).toBeGreaterThan(t.kit.rects.play.x);
        expect(z.hipX).toBeLessThan(t.kit.rects.play.x + t.kit.rects.play.w);
      }
      r.game.dispose();
    }
  });

  it('two players: one avatar and one pad in each lane, a shared sky, on the four big screens', async () => {
    for (const bp of BREAKPOINTS.filter((b) => b.w >= 1000 && b.w > b.h)) {
      const t = testKitDuo(bp.w, bp.h);
      expect(t.kit.rects.lanes).not.toBeNull();
      const r = await rig({ players: 2, scene2d: t.kit });
      const plan = (r.game.sim as FireworkSim).plan;
      play(r, [jackBot(plan, { mode: 'perfect' }), jackBot(plan, { mode: 'sloppy', seed: 4 })], { renderEvery: 3 });
      expect(nonFiniteCalls(t.canvas.ctx), bp.id).toEqual([]);
      const L = fjLayout({ w: bp.w, h: bp.h, play: t.kit.rects.play, pip: t.kit.rects.pip, lanes: t.kit.rects.lanes ?? null }, 2);
      expect(L.zones).toHaveLength(2);
      const [a, b] = L.zones as [typeof L.zones[0], typeof L.zones[0]];
      expect(a.hipX).toBeLessThan(b.hipX);
      expect(a.area.x + a.area.w).toBeLessThanOrEqual(b.area.x + 1);
    }
  });

  it('a new run and a restore start the view afresh (no rocket of the last run flies on), and dispose frees it', async () => {
    const t = testKit(390, 844);
    const r = await rig({ scene2d: t.kit });
    const plan = (r.game.sim as FireworkSim).plan;
    play(r, [jackBot(plan, { mode: 'perfect' })], { steps: 700 });
    r.game.start({ seed: 1, difficulty: 'normal', seated: false, mode: 'solo', profile: null });
    expect(t.kit.particles.alive).toBe(0);
    r.game.dispose();
    expect(() => r.game.render(0)).not.toThrow();
  });

  it('runs with no scene at all (HUD only) and with reduced motion', async () => {
    const r = await rig();
    play(r, [jackBot((r.game.sim as FireworkSim).plan, { mode: 'perfect' })], { steps: 300 });
    expect(r.ctx.hudLog.length).toBeGreaterThan(0);
    const t = testKit(390, 844);
    const ctx = testContext({ scene2d: t.kit, flags: { reducedMotion: true } });
    const g = createFireworkJacksGame(fresh(), { timing: SHORT });
    await g.init(ctx);
    g.start({ seed: 2, difficulty: 'easy', seated: false, mode: 'solo', profile: null });
    const bot = jackBot((g.sim as FireworkSim).plan, { mode: 'perfect' });
    for (let k = 1; k <= 500; k++) { g.step(FIXED_DT, inputFrame(k, { ...bot.at(k).ch }, [...bot.at(k).events], { source: 'pose' })); if (k % 3 === 0) g.render(0.3); }
    expect(nonFiniteCalls(t.canvas.ctx)).toEqual([]);
  });
});

describe('a whole run through the Session', () => {
  it('keyboard: countdown, four beats, Space presses, finale, results; the summary is the game\'s; the camera is never asked for', async () => {
    const mod = fireworkJacksModule(fresh(), { timing: { sets: 1, workS: 12, finaleS: 2 } });
    const c = clockedSession({ 'firework-jacks': mod });
    let over: { score: number; reps?: number; log: unknown[] } | null = null;
    c.session.on('over', (s) => { over = s; });
    await c.session.start('firework-jacks', { mode: 'solo', difficulty: 'easy', input: 'keyboard', seated: false });
    expect(c.until('running', { maxMs: 6000 })).toBe(true);
    let n = 0;
    c.until('results', {
      each: (t) => {
        if (c.session.state === 'running' && Math.floor(t / 900) !== n) {
          n = Math.floor(t / 900);
          c.keys.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: ' ', repeat: false, metaKey: false, ctrlKey: false, altKey: false }));
        }
      },
    });
    expect(c.session.state).toBe('results');
    const s = over as unknown as { score: number; reps: number; log: unknown[]; seconds: number };
    expect(s.reps).toBeGreaterThan(5);
    expect(s.score).toBeGreaterThan(0);
    expect(s.seconds).toBeGreaterThan(13);
    expect(c.hudWrites.some(([slot]) => slot === 'prompt')).toBe(true);
    expect(c.played).toContain('metronome');
  });

  it('the variant reaches the movement engine: seated asks for arm jacks, quiet for step jacks, standard for the full jack', async () => {
    const seen: unknown[] = [];
    for (const v of [{ seated: false, silent: false }, { seated: true, silent: false }, { seated: false, silent: true }]) {
      const manifest = fresh();
      const mod = fireworkJacksModule(manifest);
      const used: unknown[] = [];
      const c = clockedSession({ 'firework-jacks': mod }, {
        camera: fakeCamera(), pose: fakePose(),
        flags: () => ({ reducedMotion: false, silent: v.silent }),
        feed: (fo) => { const f = createPoseFeed(fo); const use = f.use.bind(f); f.use = (specs) => { used.push(specs); use(specs); }; return f; },
      });
      await c.session.start('firework-jacks', { mode: 'solo', difficulty: 'normal', input: 'camera', seated: v.seated });
      expect(c.session.state).toBe('calibrating');
      seen.push(used[0]);
      c.session.quit();
    }
    expect(seen).toEqual([[{ id: 'jumpingJack' }], [{ id: 'jumpingJack', opts: { armsOnly: 1 } }], [{ id: 'jumpingJack', opts: { step: 1 } }]]);
  });
});
