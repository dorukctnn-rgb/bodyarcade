// The three game folders as the catalogue and the shell see them: manifests that pass the catalogue's own checks and agree
// with the rules (rounds, rests, MET, free or Pro), the module's keys and words, the words reaching the game through the real
// translation table, the camera picture the shell hands over, and the seated count of calories.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkEntry } from '../../web/catalogue/validate.ts';
import { rngStream } from '../../core/loop/rng.ts';
import { createScene2D, type CanvasLike } from '../../core/render2d/scene2d.ts';
import { fakeSurfaces, recorder } from '../../core/render2d/testing/recorder.ts';
import { profileOf, SHAPE_UPPER } from '../../core/moves/testing/rig.ts';
import { createI18n, LANGS } from '../../core/ui/i18n/index.ts';
import type { AudioApi, Game, GameContext, GameManifest, Hud, InputFrame, Rng, StartOptions } from '../../core/types/index.ts';
import { FIXED_DT } from '../../core/types/index.ts';
import padWork, { manifest as padManifest, padWorkModule } from '../pad-work/index.ts';
import reactionTag, { manifest as reactManifest, reactionTagModule } from '../reaction-tag/index.ts';
import starCatch, { manifest as starManifest, starCatchModule } from '../star-catch/index.ts';
import { CURSOR_KEYS } from './cursor.ts';
import type { TargetEngine } from './engine.ts';
import { padWorkRules } from './pad-work.ts';
import { reactionTagRules } from './reaction-tag.ts';
import { starCatchRules } from './star-catch.ts';
import { GAME_STRINGS, TARGET_STRINGS } from './strings.ts';
import { frameOf, VirtualBody } from './testing/body.ts';
import { Chaser } from './testing/bots.ts';
import { seenOf } from './testing/play.ts';
import { buildTimeline } from './timeline.ts';
import { isScene2DKit, setMirrorVideo } from './video.ts';
import type { BaseSpec } from './types.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const GAMES = [
  { id: 'star-catch', mod: starCatch, manifest: starManifest, rules: starCatchRules, roundSec: 60, free: true, met: 4, order: 3, first: ['Round 1', 'Tur 1'] },
  { id: 'pad-work', mod: padWork, manifest: padManifest, rules: padWorkRules, roundSec: 120, free: false, met: 5, order: 4, first: ['Round 1', 'Tur 1'] },
  { id: 'reaction-tag', mod: reactionTag, manifest: reactManifest, rules: reactionTagRules, roundSec: 45, free: false, met: 4, order: 5, first: ['Tap green', 'Yeşile dokun'] },
] as const;

function fakeCtx(o: { t?: GameContext['t']; scene2d?: GameContext['scene2d']; seated?: boolean } = {}): { ctx: GameContext; hud: [string, unknown][] } {
  const hud: [string, unknown][] = [];
  const streams = new Map<string, Rng>();
  const h: Hud = { set: (slot, v) => { hud.push([slot, v]); }, announce() {}, toast() {} };
  const ctx: GameContext = {
    pose: {} as GameContext['pose'], input: {} as GameContext['input'], hud: h,
    audio: { play() {}, unlock() {}, clock: () => ({ now: () => 0, schedule() {}, latencyMs: 0 }) } as AudioApi,
    store: { get: <T>(_k: string, _s: unknown, f: T) => f, set() {}, remove() {} },
    rng: (name) => { let s = streams.get(name); if (!s) { s = rngStream(7, name); streams.set(name, s); } return s; },
    flags: { reducedMotion: false, silent: false, seated: o.seated ?? false },
    t: o.t ?? ((k: string) => k),
    ...(o.scene2d ? { scene2d: o.scene2d } : {}),
  };
  return { ctx, hud };
}

function fakeKit(w = 1280, h = 800) {
  const ctx = recorder();
  let cw = 0, ch = 0;
  const canvas = {
    get width() { return cw; }, set width(v: number) { cw = v; }, get height() { return ch; }, set height(v: number) { ch = v; },
    clientWidth: w, clientHeight: h, getContext: () => ctx as unknown as CanvasRenderingContext2D,
  } as unknown as CanvasLike;
  const surf = fakeSurfaces();
  const kit = createScene2D({ canvas, size: () => ({ width: w, height: h }), devicePixelRatio: () => 1, surfaces: surf.factory, rng: rngStream(2, 'fx') });
  return { kit, ctx, surf };
}

const START = (o: Partial<StartOptions> = {}): StartOptions => ({ seed: 1, difficulty: 'normal', seated: false, mode: 'solo', profile: profileOf(SHAPE_UPPER, 'upper'), ...o });

/** A chasing player through the real detector, for `steps` steps or until the run ends. */
async function run(mod: { create(): Game }, ctx: GameContext, o: { start?: Partial<StartOptions>; steps?: number; render?: number } = {}): Promise<Game> {
  const g = mod.create();
  await g.init(ctx);
  g.start(START(o.start));
  const body = new VirtualBody({ clockOffset: 5000 });
  const chaser = new Chaser('perfect', 1);
  let phase = 'running';
  for (let k = 1; k <= (o.steps ?? 60 * 400) && phase === 'running'; k++) {
    const lane = (g as unknown as { engine: TargetEngine<BaseSpec> }).engine.view().lanes[0]!;
    chaser.steer(body, seenOf(lane));
    const input: InputFrame = frameOf(k, body.step(k));
    phase = g.step(FIXED_DT, input).phase;
    if (k % (o.render ?? 2) === 0) g.render(0.5);
  }
  g.render(1);
  return g;
}

describe.each(GAMES)('$id folder', ({ id, mod, manifest, rules, roundSec, free, met, order, first }) => {
  it('has a manifest that passes the catalogue checks, with the tile art and Turkish copy', () => {
    const raw = JSON.parse(readFileSync(`${ROOT}packages/games/${id}/manifest.json`, 'utf8')) as unknown;
    const { problems } = checkEntry(raw, id, { requiredLangs: ['tr'], tilesDir: `${ROOT}design/art/tiles` });
    expect(problems).toEqual([]);
  });

  it('agrees with the rules: the id, the template, the rounds and rests, MET, free or Pro, two players, the order', () => {
    expect(manifest.id).toBe(id);
    expect(rules.id).toBe(id);
    expect(manifest.template).toBe('target');
    // a game can be raced exactly when its rules can make a plan from the Room's course
    expect(manifest.modes).toEqual((rules as { planDuel?: unknown }).planDuel ? ['solo', 'local2', 'duel'] : ['solo', 'local2']);
    expect(manifest.free).toBe(free);
    expect(manifest.met).toBe(met);
    expect((manifest as unknown as { catalogue: { order: number } }).catalogue.order).toBe(order);
    const tl = buildTimeline(manifest.durationSec, rules.rounds, rules.restSec);
    expect(tl.rounds).toBe(3);
    expect(tl.roundMs / 1000).toBe(roundSec);
    expect(existsSync(`${ROOT}design/art/tiles/${id}.webp`)).toBe(true);
  });

  it('is a GameModule: a Game of its own manifest, the keyboard cursors, and the words in five languages', () => {
    expect(mod.manifest).toBe(manifest);
    expect(mod.create().manifest).toBe(manifest);
    expect(mod.controls?.keys).toBe(CURSOR_KEYS);
    expect(Object.keys(mod.strings).sort()).toEqual([...LANGS].sort());
    for (const l of LANGS) {
      expect(Object.keys(mod.strings[l]).length).toBe(Object.keys(TARGET_STRINGS[l]).length);
      expect(Object.keys(mod.strings[l]).every((k) => k.startsWith('target.'))).toBe(true);
    }
    expect(mod.strings).toBe(GAME_STRINGS);
  });

  it('gets its words from the real translation table when the shell extends game.<id> with module.strings', async () => {
    const i18n = createI18n('tr');
    i18n.extend(`game.${id}`, mod.strings);
    const { ctx, hud } = fakeCtx({ t: i18n.scoped(`game.${id}`) });
    await run(mod, ctx, { steps: 60 * 3 });
    const prompts = hud.filter(([s]) => s === 'prompt').map(([, v]) => JSON.stringify(v));
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.some((p) => p.includes(first[1]))).toBe(true);
    expect(prompts.some((p) => p.includes(first[0]))).toBe(false);
  });

  it('plays in English from its own table when the shell has not been given the words', async () => {
    const { ctx, hud } = fakeCtx();
    await run(mod, ctx, { steps: 60 * 3 });
    expect(hud.filter(([s]) => s === 'prompt').some(([, v]) => JSON.stringify(v).includes(first[0]))).toBe(true);
  });
});

describe('the camera picture', () => {
  it('is drawn as the scene once the shell has handed the video element over, and not before it has a frame', async () => {
    const { kit, ctx } = fakeKit();
    expect(isScene2DKit(kit)).toBe(true);
    const { ctx: gctx } = fakeCtx({ scene2d: kit });
    const g = starCatchModule().create();
    await g.init(gctx);
    g.start(START());
    const video = { readyState: 1, videoWidth: 1280, videoHeight: 720 } as unknown as HTMLVideoElement;
    const drawn = (): number => ctx.calls.filter((c) => c.name === 'drawImage' && c.args[0] === video).length;
    g.render(0.5);
    expect(drawn()).toBe(0);
    setMirrorVideo(kit, video);
    g.render(0.5);
    expect(drawn()).toBe(0);                       // no frame yet
    (video as unknown as { readyState: number }).readyState = 4;
    g.render(0.5);
    expect(drawn()).toBe(1);
    setMirrorVideo(kit, null);                     // the camera was released
    g.render(0.5);
    expect(drawn()).toBe(1);
    g.dispose();
  });

  it('is never shared between two scenes', async () => {
    const a = fakeKit(), b = fakeKit();
    const video = { readyState: 4, videoWidth: 640, videoHeight: 480 } as unknown as HTMLVideoElement;
    setMirrorVideo(a.kit, video);
    const g = padWorkModule().create();
    await g.init(fakeCtx({ scene2d: b.kit }).ctx);
    g.start(START());
    g.render(0.5);
    expect(b.ctx.calls.some((c) => c.name === 'drawImage' && c.args[0] === video)).toBe(false);
    g.dispose();
    setMirrorVideo(a.kit, null);
  });

  it('sets up the mirror layout (no self view window) when nobody has', async () => {
    const solo = fakeKit();
    const g = reactionTagModule().create();
    await g.init(fakeCtx({ scene2d: solo.kit }).ctx);
    expect(solo.kit.rects.pip).not.toBeNull();     // the kit starts in scene mode with a self view
    g.start(START());
    expect(solo.kit.rects.pip).toBeNull();
    g.dispose();
  });

  it('a context with only the contract Scene2D (no kit) plays with the HUD only and never fails', async () => {
    const plain = { mirror: { show() {}, project: (v: { x: number; y: number }) => v }, ctx: {} as CanvasRenderingContext2D, resize() {}, dispose() {} };
    const { ctx, hud } = fakeCtx({ scene2d: plain });
    const g = await run(starCatchModule(starManifest, { rounds: 1 }), ctx, { steps: 60 * 4 });
    expect(hud.some(([s]) => s === 'timer')).toBe(true);
    g.dispose();
  });
});

describe('calories', () => {
  it('a seated run is counted at the seated MET at most, a standing one at the manifest MET', async () => {
    const short = (m: GameManifest): GameManifest => ({ ...m, durationSec: 20 });
    const stand = await run(starCatchModule(short(starManifest), { rounds: 1 }), fakeCtx().ctx, {});
    const sit = await run(starCatchModule(short(starManifest), { rounds: 1 }), fakeCtx({ seated: true }).ctx, { start: { seated: true } });
    const a = stand.summary().metSeconds, b = sit.summary().metSeconds;
    expect(a).toBeCloseTo(4 * 20, 0);
    expect(b).toBeCloseTo(3 * 20, 0);
    expect(b).toBeLessThan(a);
  });
});
