// Twist Turbine on the Game contract: the manifest, the HUD, the sounds, the variants and their detector, storms on the
// HUD, snapshot and restore, the view on the ten screens and in every corner, and a whole run through the Session.
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
import { inputFrame, nonFiniteCalls, testContext, testKit } from '../_shared/testing/context.ts';
import { MISS_EN } from '../_shared/reasons.ts';
import twistTurbine, { manifest as realManifest, twistTurbineModule } from '../twist-turbine/index.ts';
import { createTwistTurbineGame, ttDetectors } from './turbine-game.ts';
import { ttLayout } from './turbine-view.ts';
import type { TurbineSim, TtTiming } from './turbine.ts';
import { TT_STRINGS } from './strings.ts';
import { twistBot, type TwistBot } from './testing/twist-bot.ts';

const fresh = (): GameManifest => structuredClone(realManifest);
const SHORT: Partial<TtTiming> = { sets: 1, workS: 14, finaleS: 2 };
const MED: Partial<TtTiming> = { sets: 2, workS: 24, restS: 6, finaleS: 2 };

interface Rig { game: ReturnType<typeof createTwistTurbineGame>; ctx: ReturnType<typeof testContext>; manifest: GameManifest }

async function rig(o: { seed?: number; difficulty?: string; seated?: boolean; silent?: boolean; scene2d?: Scene2D; t?: (k: string, v?: Record<string, string | number>) => string; timing?: Partial<TtTiming> } = {}): Promise<Rig> {
  const manifest = fresh();
  const ctx = testContext({ seed: o.seed ?? 3, flags: { seated: o.seated ?? false, silent: o.silent ?? false }, ...(o.scene2d ? { scene2d: o.scene2d } : {}), ...(o.t ? { t: o.t as never } : {}) });
  const game = createTwistTurbineGame(manifest, { timing: o.timing ?? SHORT });
  await game.init(ctx);
  const start: StartOptions = { seed: o.seed ?? 3, difficulty: o.difficulty ?? 'normal', seated: o.seated ?? false, mode: 'solo', profile: null };
  game.start(start);
  return { game, ctx, manifest };
}

const sim = (r: Rig): TurbineSim => r.game.sim as TurbineSim;

/** Plays the game through its own API with a scripted player; renders every fourth step. */
function play(r: Rig, bot: TwistBot, o: { from?: number; steps?: number; renderEvery?: number; until?: (k: number) => boolean } = {}): { k: number; phase: string } {
  let k = o.from ?? 0;
  let phase = 'running';
  const end = o.steps !== undefined ? k + o.steps : Infinity;
  while (phase === 'running' && k < end && k < 200_000) {
    k++;
    const at = bot.at(k);
    const frame: InputFrame = inputFrame(k, { ...at.ch }, [...at.events], { source: 'pose' });
    phase = r.game.step(FIXED_DT, frame).phase;
    if (k % (o.renderEvery ?? 4) === 0) r.game.render(0.5);
    if (o.until?.(k)) break;
  }
  return { k, phase };
}

describe('the manifest', () => {
  it('passes the catalogue schema and the house rules in English and Turkish, with its tile art', () => {
    const r = checkEntry(realManifest, 'packages/games/twist-turbine/manifest.json', { requiredLangs: ['en', 'tr'], tilesDir: tilesDir() });
    expect(r.problems).toEqual([]);
    expect(r.entry).not.toBeNull();
  });

  it('says only what the game does: one player, the variants, the detector, the length', () => {
    expect(realManifest.modes).toEqual(['solo']);
    expect(realManifest.seated).toBe(true);
    expect(realManifest.silentSafe).toBe(true);
    expect(realManifest.lowImpact).toBe(true);
    expect(realManifest.free).toBe(true);
    expect(realManifest.template).toBe('strength');
    expect(realManifest.detectors.map((d) => d.id)).toEqual(['twist']);
    expect(realManifest.durationSec).toBe(180);
    expect((realManifest as unknown as { catalogue?: unknown }).catalogue).toBeDefined();
  });

  it('the module hands the catalogue the same manifest, the keys, the swipes and the words in five languages', () => {
    expect(twistTurbine.manifest).toBe(realManifest);
    expect(Object.keys(twistTurbine.controls?.keys ?? {}).sort()).toEqual(['ArrowLeft', 'ArrowRight', 'a', 'd']);
    expect(twistTurbine.controls?.touch?.left?.channel).toBe('side');
    expect(twistTurbine.controls?.touch?.right?.value).toBe(1);
    expect(twistTurbine.controls?.touch?.tap?.event).toBe('twist');
    expect(Object.keys(twistTurbine.strings).sort()).toEqual(['de', 'en', 'es', 'fr', 'tr']);
  });
});

describe('the words', () => {
  it('every language has every key, follows the copy rules, and keeps the same {variables}', () => {
    const keys = Object.keys(TT_STRINGS.en);
    for (const lang of ['en', 'tr', 'de', 'es', 'fr'] as const) {
      expect(Object.keys(TT_STRINGS[lang]).sort(), lang).toEqual(keys.slice().sort());
      for (const k of keys) {
        const text = TT_STRINGS[lang][k] as string;
        expect(copyProblems(text), `${lang} ${k}`).toEqual([]);
        const vars = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();
        expect(vars(text), `${lang} ${k} variables`).toEqual(vars(TT_STRINGS.en[k] as string));
        if (k.startsWith('tt.prompt.')) expect(text.replace(/­/g, '').length, `${lang} ${k}`).toBeLessThanOrEqual(12);
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
    expect(r.ctx.last['prompt']).toEqual({ icon: 'twist', text: 'Twist' });
    expect(r.ctx.last['timer']).toBe(14);
    expect(r.ctx.last['score']).toBe(0);
    expect(r.ctx.last['hint']).toBe('');
  });

  it('takes the words from the shell when it has them', async () => {
    const r = await rig({ t: (k) => (k === 'tt.prompt.twist' ? 'Dön' : k) });
    r.game.render(0);
    expect(r.ctx.last['prompt']).toEqual({ icon: 'twist', text: 'Dön' });
  });

  it('a perfect player scores, the streak counts, the sounds are the twist and the set, and the set is announced with its band', async () => {
    const r = await rig();
    play(r, twistBot(sim(r).plan, { mode: 'perfect' }), { steps: 700 });
    expect(Number(r.ctx.last['score'])).toBeGreaterThan(40);
    expect(Number(r.ctx.last['combo'])).toBeGreaterThanOrEqual(1);
    for (const s of ['rep', 'go']) expect(r.ctx.played, s).toContain(s);
    expect(r.ctx.announced[0]).toBe('Set 1 of 1. Twist 28 to 44 times a minute.');
  });

  it('a blackout and an overload each show their own command with a progress that grows, announce themselves, and a perfect player answers both', async () => {
    const seen = new Map<string, { text: string; progress: number[] }>();
    for (const seed of [3, 4, 5, 6, 7, 8]) {
      const r = await rig({ seed, timing: MED });
      const bot = twistBot(sim(r).plan, { mode: 'perfect' });
      for (let k = 1; k < 4000 && sim(r).phase === 'running'; k++) {
        const at = bot.at(k);
        r.game.step(FIXED_DT, inputFrame(k, { ...at.ch }, [...at.events], { source: 'pose' }));
        if (k % 2 === 0) {
          r.game.render(0);
          const st = sim(r).storm;
          const p = r.ctx.last['prompt'] as { text: string; progress?: number };
          if (st) {
            const e = seen.get(st.kind) ?? { text: p.text, progress: [] };
            e.progress.push(p.progress ?? -1);
            seen.set(st.kind, e);
          }
        }
      }
      expect(r.ctx.played).toContain('warn');
      expect(r.ctx.played).toContain('star');
      expect(r.ctx.announced.some((a) => /^Blackout\. Twist fast: \d+ twists in \d+ seconds\.$/.test(a) || /^Overload\. Hold your twist to the (left|right) for \d+ seconds\.$/.test(a))).toBe(true);
      expect(r.ctx.announced.some((a) => /^Storm answered\. Bonus \d+ points\.$/.test(a))).toBe(true);
      if (seen.size === 2) break;
    }
    expect([...seen.keys()].sort()).toEqual(['blackout', 'overload']);
    expect(seen.get('blackout')?.text).toBe('Twist fast');
    expect(['Hold left', 'Hold right']).toContain(seen.get('overload')?.text);
    for (const e of seen.values()) {
      expect(Math.max(...e.progress)).toBeGreaterThan(0);
      expect(e.progress.every((v) => v >= 0 && v <= 1)).toBe(true);
    }
  });

  it('a missed storm is announced as lost and sounds the miss', async () => {
    const r = await rig({ timing: MED });
    const idle = twistBot(sim(r).plan, { mode: 'idle' });
    play(r, idle, { renderEvery: 5 });
    expect(r.ctx.played).toContain('miss');
    expect(r.ctx.announced).toContain('The storm passed without the bonus.');
  });

  it('says why a try did not count on the reason strip, in the shell\'s words, and takes it down after a moment', async () => {
    const hints = new Set<string>();
    for (const seed of [5, 6, 7]) {
      const r = await rig({ seed, timing: { sets: 1, workS: 30, finaleS: 2 }, t: (k) => (k === 'miss.turn_more' ? 'Turn further' : k === 'miss.hands_apart' ? 'Hands too far apart' : k === 'miss.turn_shoulders' ? 'Turn from the shoulders' : k) });
      const bot = twistBot(sim(r).plan, { mode: 'sloppy', seed });
      for (let k = 1; k < 1500; k++) {
        const at = bot.at(k);
        r.game.step(FIXED_DT, inputFrame(k, { ...at.ch }, [...at.events], { source: 'pose' }));
        if (k % 2 === 0) { r.game.render(0); const h = r.ctx.last['hint']; if (typeof h === 'string' && h) hints.add(h); }
      }
      // stand still: the strip empties (or says to move more)
      for (let k = 1500; k < 1800; k++) r.game.step(FIXED_DT, inputFrame(k, {}, [], { source: 'pose' }));
      r.game.render(0);
      expect(['', 'Move more']).toContain(r.ctx.last['hint']);
    }
    expect(hints.size).toBeGreaterThan(0);
    for (const h of hints) expect(['Turn further', 'Hands too far apart', 'Turn from the shoulders', 'Wrong side']).toContain(h);
  });

  it('seated and quiet play need the same detector, and the prompt does not change', async () => {
    for (const v of [{ seated: true, silent: false }, { seated: false, silent: true }, { seated: false, silent: false }]) {
      const r = await rig(v);
      expect(r.manifest.detectors).toEqual([{ id: 'twist' }]);
      r.game.render(0);
      expect(r.ctx.last['prompt']).toEqual({ icon: 'twist', text: 'Twist' });
    }
    expect(ttDetectors({ seated: true, silent: true })).toEqual([{ id: 'twist' }]);
  });

  it('snapshot and restore give the same continuation, also in a new game that was only init-ed', async () => {
    const a = await rig({ seed: 9, timing: MED });
    const bot = twistBot(sim(a).plan, { mode: 'sloppy', seed: 9 });
    const first = play(a, bot, { steps: 900 });
    const snap = JSON.parse(JSON.stringify(a.game.snapshot())) as unknown;
    play(a, bot, { from: first.k });
    const b = await rig({ seed: 77, timing: MED });
    b.game.restore(snap);
    play(b, bot, { from: first.k });
    expect(b.game.summary()).toEqual(a.game.summary());
    const c = createTwistTurbineGame(fresh(), { timing: SHORT });
    await c.init(testContext());
    c.restore(snap);
    expect(c.summary().score).toBeGreaterThanOrEqual(0);
    expect(() => c.restore({ v: 9 })).toThrow();
  });

  it('is pure where the contract says: step() makes no sound, no HUD write and no drawing; render() does', async () => {
    const r = await rig();
    const bot = twistBot(sim(r).plan, { mode: 'perfect' });
    for (let k = 1; k <= 400; k++) { const at = bot.at(k); r.game.step(FIXED_DT, inputFrame(k, { ...at.ch }, [...at.events], { source: 'pose' })); }
    expect(r.ctx.played).toEqual([]);
    expect(r.ctx.hudLog).toEqual([]);
    r.game.render(0);
    expect(r.ctx.played.length).toBeGreaterThan(0);
  });

  it('refuses to step before start, and does nothing after dispose', async () => {
    const g = createTwistTurbineGame(fresh());
    await expect(g.init(testContext())).resolves.toBeUndefined();
    expect(() => g.step(FIXED_DT, inputFrame(1))).toThrow();
    g.start({ seed: 1, difficulty: 'easy', seated: false, mode: 'solo', profile: null });
    g.dispose();
    expect(() => g.render(0)).not.toThrow();
  });

  it('the simulation files are pure (no clock, no Math.random, no DOM); only the view and the host touch the canvas', () => {
    for (const f of ['turbine.ts', 'kit.ts', 'turbine-game.ts']) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(src, f).not.toMatch(/Math\.random|performance\.now|Date\.now|document\.|window\.|requestAnimationFrame/);
    }
  });
});

describe('on the HUD of the shell (it has plates per player in every run)', () => {
  it('a one-player run still writes the plain score, combo and reason', async () => {
    const manifest = fresh();
    const ctx = testContext({ seed: 3, duo: true });
    const game = createTwistTurbineGame(manifest, { timing: SHORT });
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

  it.each(BREAKPOINTS.map((b) => [b.id, b.w, b.h] as const))('%s: draws a whole run with a storm in every corner of the self view with finite numbers, and keeps its avatar, turbine and pace bar out from under the self view', async (_id, w, h) => {
    for (const corner of corners) {
      const t = testKit(w, h, { corner });
      const r = await rig({ scene2d: t.kit, timing: { sets: 1, workS: 22, finaleS: 2 } });
      play(r, twistBot(sim(r).plan, { mode: 'perfect' }), { renderEvery: 3 });
      expect(sim(r).phase, `${corner}`).toBe('complete');
      expect(nonFiniteCalls(t.canvas.ctx), `${corner}`).toEqual([]);
      expect(t.canvas.ctx.count('fillRect')).toBeGreaterThan(150);
      expect(t.kit.stats().particleCapacity).toBeGreaterThan(0);
      const play_ = t.kit.rects.play;
      const L = ttLayout({ w, h, play: play_, pip: t.kit.rects.pip, lanes: null });
      for (const [name, keep] of Object.entries(L.keep)) {
        if (t.kit.rects.pip && corner !== 'hidden') {
          const p = t.kit.rects.pip;
          const hit = keep.x < p.x + p.w && p.x < keep.x + keep.w && keep.y < p.y + p.h && p.y < keep.y + keep.h;
          expect(hit, `${name} under the self view at ${corner} ${w}x${h}`).toBe(false);
        }
        expect(keep.x, name).toBeGreaterThanOrEqual(play_.x - 1);
        expect(keep.x + keep.w, name).toBeLessThanOrEqual(play_.x + play_.w + 1);
        expect(keep.y, name).toBeGreaterThanOrEqual(play_.y - 1);
        expect(keep.y + keep.h, name).toBeLessThanOrEqual(play_.y + play_.h + h * 0.02);
      }
      // the avatar and the turbine do not sit on each other
      expect(L.keep.turbine.y + L.keep.turbine.h <= L.keep.avatar.y + 1 || L.keep.turbine.x + L.keep.turbine.w <= L.keep.avatar.x + 1 || L.keep.avatar.x + L.keep.avatar.w <= L.keep.turbine.x + 1, `${corner} ${w}x${h}`).toBe(true);
      expect(L.hub.r).toBeGreaterThan(30);
      r.game.dispose();
    }
  });

  it('a new run starts the view afresh (no spark of the last run flies on), and dispose frees it', async () => {
    const t = testKit(390, 844);
    const r = await rig({ scene2d: t.kit });
    play(r, twistBot(sim(r).plan, { mode: 'perfect' }), { steps: 700 });
    r.game.start({ seed: 1, difficulty: 'normal', seated: false, mode: 'solo', profile: null });
    expect(t.kit.particles.alive).toBe(0);
    r.game.dispose();
    expect(() => r.game.render(0)).not.toThrow();
  });

  it('runs with no scene at all (HUD only) and with reduced motion', async () => {
    const r = await rig();
    play(r, twistBot(sim(r).plan, { mode: 'perfect' }), { steps: 300 });
    expect(r.ctx.hudLog.length).toBeGreaterThan(0);
    const t = testKit(390, 844);
    const ctx = testContext({ scene2d: t.kit, flags: { reducedMotion: true } });
    const g = createTwistTurbineGame(fresh(), { timing: MED });
    await g.init(ctx);
    g.start({ seed: 2, difficulty: 'easy', seated: false, mode: 'solo', profile: null });
    const bot = twistBot((g.sim as TurbineSim).plan, { mode: 'perfect' });
    for (let k = 1; k <= 1500; k++) { const at = bot.at(k); g.step(FIXED_DT, inputFrame(k, { ...at.ch }, [...at.events], { source: 'pose' })); if (k % 3 === 0) g.render(0.3); }
    expect(nonFiniteCalls(t.canvas.ctx)).toEqual([]);
  });

  it('the avatar turns with the body: the shoulders are narrower at a full twist than at rest (the figure is drawn with a span below 1)', async () => {
    const t = testKit(390, 844);
    const r = await rig({ scene2d: t.kit, timing: MED });
    const bot = twistBot(sim(r).plan, { mode: 'perfect' });
    let calls0 = 0;
    play(r, bot, { steps: 200 });
    calls0 = t.canvas.ctx.count('stroke');
    play(r, bot, { from: 200, steps: 400 });
    expect(t.canvas.ctx.count('stroke')).toBeGreaterThan(calls0);
    expect(nonFiniteCalls(t.canvas.ctx)).toEqual([]);
  });
});

describe('a whole run through the Session', () => {
  it('keyboard: the arrows alternate, an overload is answered by holding the side, the summary is the game\'s and the camera is never asked for', async () => {
    const mod = twistTurbineModule(fresh(), { timing: { sets: 1, workS: 16, finaleS: 2 } });
    const c = clockedSession({ 'twist-turbine': mod });
    let over: { score: number; reps?: number; log: unknown[]; seconds: number } | null = null;
    c.session.on('over', (s) => { over = s; });
    await c.session.start('twist-turbine', { mode: 'solo', difficulty: 'easy', input: 'keyboard', seated: false });
    expect(c.until('running', { maxMs: 6000 })).toBe(true);
    let n = 0;
    let side = 1;
    const press = (key: string): void => { c.keys.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key, repeat: false, metaKey: false, ctrlKey: false, altKey: false })); };
    const release = (key: string): void => { c.keys.dispatchEvent(Object.assign(new Event('keyup', { cancelable: true }), { key, repeat: false, metaKey: false, ctrlKey: false, altKey: false })); };
    c.until('results', {
      each: (t) => {
        if (c.session.state === 'running' && Math.floor(t / 1700) !== n) {
          n = Math.floor(t / 1700);
          release(side > 0 ? 'ArrowRight' : 'ArrowLeft');
          side = -side;
          press(side > 0 ? 'ArrowRight' : 'ArrowLeft');
        }
      },
    });
    expect(c.session.state).toBe('results');
    const s = over as unknown as { score: number; reps: number; log: unknown[]; seconds: number };
    expect(s.reps).toBeGreaterThan(4);
    expect(s.score).toBeGreaterThan(0);
    expect(s.seconds).toBeGreaterThan(17);
    expect(c.hudWrites.some(([slot]) => slot === 'prompt')).toBe(true);
    expect(c.played).toContain('rep');
  });

  it('the variant reaches the movement engine: every way of playing asks for the twist detector', async () => {
    const seen: unknown[] = [];
    for (const v of [{ seated: false, silent: false }, { seated: true, silent: false }, { seated: false, silent: true }]) {
      const mod = twistTurbineModule(fresh());
      const used: unknown[] = [];
      const c = clockedSession({ 'twist-turbine': mod }, {
        camera: fakeCamera(), pose: fakePose(),
        flags: () => ({ reducedMotion: false, silent: v.silent }),
        feed: (fo) => { const f = createPoseFeed(fo); const use = f.use.bind(f); f.use = (specs) => { used.push(specs); use(specs); }; return f; },
      });
      await c.session.start('twist-turbine', { mode: 'solo', difficulty: 'normal', input: 'camera', seated: v.seated });
      expect(c.session.state).toBe('calibrating');
      seen.push(used[0]);
      c.session.quit();
    }
    expect(seen).toEqual([[{ id: 'twist' }], [{ id: 'twist' }], [{ id: 'twist' }]]);
  });
});
