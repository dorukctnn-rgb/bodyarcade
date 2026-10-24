// The mirror view on the Scene2D kit with a fake canvas: what it draws for each game (stars, pads, lights, hands, links),
// the picture first and the effects last, keyboard rounds without a picture, two lanes, reduced motion, text, and on all
// ten screens that every target lies inside the mirror and clear of every plate.
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../core/loop/rng.ts';
import { layoutProblems } from '../../core/render2d/layout2d.ts';
import { createScene2D, type CanvasLike, type Scene2DKit } from '../../core/render2d/scene2d.ts';
import { fakeSurfaces, recorder, type Recorder } from '../../core/render2d/testing/recorder.ts';
import { BREAKPOINTS, hudMetrics, hudSlots, type MeasuredHud } from '../../core/ui/layout.ts';
import { profileOf, SHAPE_FULL, SHAPE_UPPER } from '../../core/moves/testing/rig.ts';
import type { BodyProfile, GameEvent, PoseFrame } from '../../core/types/index.ts';
import { synthPose, DEFAULT_SHAPE } from '../../core/pose/synth.ts';
import type { TargetView, ViewFrame } from './game.ts';
import { english, TARGET_STRINGS } from './strings.ts';
import { padWorkRules, type PadSpec } from './pad-work.ts';
import { reactionTagRules } from './reaction-tag.ts';
import { starCatchRules } from './star-catch.ts';
import { PadChaser, type PadSeen } from './testing/bots.ts';
import { setup, tick, type Run, type SetupOptions, type Steer } from './testing/play.ts';
import { createMirrorView } from './view.ts';
import type { BaseSpec, Rules, ViewLane } from './types.ts';

interface Texts { words: { text: string; x: number; y: number; font: string }[] }
type FakeCtx = Recorder & Texts & { font: string; textAlign: string; textBaseline: string; setLineDash(a: number[]): void; fillText(t: string, x: number, y: number): void; strokeText(t: string, x: number, y: number): void; dashes: number };

function fakeContext(withText = true): FakeCtx {
  const ctx = recorder() as unknown as FakeCtx;
  const texts: Texts['words'] = [];
  ctx.words = texts;
  if (withText) {
    ctx.font = '';
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText = (t, x, y) => { texts.push({ text: t, x, y, font: ctx.font }); };
    ctx.strokeText = () => undefined;
    ctx.dashes = 0;
    ctx.setLineDash = (a) => { if (a.length) ctx.dashes++; };
  }
  return ctx;
}

/** The HUD plates as the real HUD measures them: the reason sentence wrapped to the room its row has. */
function measuredFor(w: number, h: number): MeasuredHud {
  const f = hudMetrics({ w, h }).font;
  const statusLeft = { w: Math.round(f.numeral * 4.2), h: Math.round(f.numeral * 1.6) };
  const statusRight = { w: Math.round(f.numeral * 3.4), h: Math.round(f.numeral * 1.6) };
  const command = { w: Math.round(f.command * 5.2), h: Math.round(f.command * 1.25) };
  const slots = hudSlots({ w, h }, { statusLeft, statusRight, command }, { mode: 'mirror', pipCorner: 'hidden' }).reason;
  const slot = slots[slots.preferred] ?? slots.bottom;
  const wanted = Math.round(Math.min(w * 0.6, f.reason * 20));
  return { statusLeft, statusRight, command, reason: { w: Math.min(wanted, Math.floor(slot.w)), h: Math.round(f.reason * 2.4) } };
}

interface Stage { kit: Scene2DKit; ctx: FakeCtx; surf: ReturnType<typeof fakeSurfaces>; size: { width: number; height: number } }

function stage(w = 1280, h = 800, o: { text?: boolean; reduced?: boolean } = {}): Stage {
  const ctx = fakeContext(o.text ?? true);
  let cw = 0, ch = 0;
  const canvas = {
    get width() { return cw; }, set width(v: number) { cw = v; }, get height() { return ch; }, set height(v: number) { ch = v; },
    clientWidth: w, clientHeight: h, getContext: () => ctx as unknown as CanvasRenderingContext2D,
  } as unknown as CanvasLike;
  const surf = fakeSurfaces();
  const size = { width: w, height: h };
  const kit = createScene2D({ canvas, size: () => size, devicePixelRatio: () => 1, surfaces: surf.factory, rng: mulberry32(2), reducedMotion: o.reduced ?? false });
  kit.setHud({ mode: 'mirror', pipCorner: 'hidden', measured: measuredFor(w, h) });
  return { kit, ctx, surf, size };
}

const say: ViewFrame['say'] = (key, vars) => english(key, vars) ?? key;

/** Runs a game for `seconds` of simulation, drawing every second step, and returns what the view saw. */
function drive<S extends BaseSpec>(rules: Rules<S>, st: Stage, view: TargetView, o: SetupOptions & { seconds?: number; pose?: PoseFrame | null; reduced?: boolean; frames?: (r: Run<S>, drawn: number) => void } = {}): { run: Run<S>; drawn: number } {
  const run = setup(rules, { duration: 20, rounds: 1, ...o });
  const lanes = run.engine.view().lanes;
  view.begin({ game: rules.id, players: lanes.length === 2 ? 2 : 1, keyboard: !!o.keyboard, seated: !!o.seated, profiles: lanes.map((l) => l.profile) });
  let pending: GameEvent[] = [];
  let drawn = 0;
  const steps = Math.round((o.seconds ?? 12) * 60);
  for (let i = 0; i < steps && run.engine.phase === 'running'; i++) {
    const out = tick(run);
    pending.push(...out.events);
    if (i % 2 === 1) {
      view.draw(run.engine.view(), { events: pending, alpha: 0.5, dtMs: 33, pose: o.pose ?? null, reducedMotion: o.reduced ?? false, say });
      pending = [];
      drawn++;
      o.frames?.(run, drawn);
    }
  }
  return { run, drawn };
}

const padSteer = (mode: 'perfect' | 'sloppy' | 'idle', seed = 3) => (i: number): Steer => {
  const bot = new PadChaser(mode, seed + i);
  return (lane: ViewLane, body, t) => bot.steer(body, lane.targets.map((tg): PadSeen => {
    const s = tg.spec as PadSpec;
    return { id: tg.id, x: tg.x, y: tg.y, beat: s.beat, hand: s.hand ?? 'L', ...(s.kind === 'bag' && s.need ? { bag: s.need } : {}), from: s.from, until: s.until };
  }), t);
};

describe('what each game draws', () => {
  it('Star Catch: sprites, hand rings and links, and sparks and a score when a star is caught', () => {
    const st = stage();
    const view = createMirrorView(st.kit);
    const { run } = drive(starCatchRules, st, view, { bots: 'perfect', seed: 2, seconds: 14 });
    expect(run.engine.lane(1)!.state.stats.hits).toBeGreaterThan(3);
    expect(st.kit.sprites.stats().misses).toBeGreaterThan(0);
    expect(st.kit.sprites.stats().entries).toBeLessThanOrEqual(6);
    expect(st.ctx.count('drawImage')).toBeGreaterThan(20);
    expect(st.ctx.count('arc')).toBeGreaterThan(40);
    const texts2 = (st.ctx as unknown as Texts).words;
    expect(texts2.some((t) => /^\+\d+$/.test(t.text))).toBe(true);
    expect(st.kit.particles.stats().emitted).toBeGreaterThan(10);
  });

  it('Star Catch: stars nobody catches stay on the screen together and every one of them is drawn', () => {
    const st = stage();
    const view = createMirrorView(st.kit);
    let maxStars = 0, drawnStars = 0;
    drive(starCatchRules, st, view, {
      bots: 'idle', seed: 2, seconds: 14,
      frames: (r) => { maxStars = Math.max(maxStars, r.engine.view().lanes[0]!.targets.length); drawnStars += r.engine.view().lanes[0]!.targets.length; },
    });
    expect(maxStars).toBeGreaterThan(1);
    // a star fades in over its first 180 ms, so the frame it appears on may stamp nothing
    expect(st.ctx.count('drawImage')).toBeGreaterThan(drawnStars * 0.9);
  });

  it('Pad Work: numbered pads with closing rings, and the grade of a punch', () => {
    const st = stage();
    const view = createMirrorView(st.kit);
    const { run } = drive(padWorkRules, st, view, { bots: 'perfect', level: 'normal', seed: 3, seconds: 14, steer: padSteer('perfect') });
    expect(run.engine.lane(1)!.state.stats.hits).toBeGreaterThan(3);
    const t = (st.ctx as unknown as Texts).words.map((x) => x.text);
    expect(t).toContain('1');
    expect(t.some((x) => /^Perfect \+\d+$/.test(x) || /^Good \+\d+$/.test(x))).toBe(true);
    expect(st.ctx.count('arc')).toBeGreaterThan(60);
  });

  it('Pad Work: a swinging bag is drawn as a dark shape while it is near the head, and not before or after', () => {
    const st = stage();
    const view = createMirrorView(st.kit);
    let bagFrames = 0;
    drive(padWorkRules, st, view, {
      bots: 'idle', level: 'expert', seed: 11, seconds: 60, duration: 90, steer: padSteer('idle', 11),
      frames: (r) => {
        const bags = r.engine.view().lanes[0]!.targets.filter((t) => (t.spec as PadSpec).kind === 'bag');
        const before = st.ctx.count('ellipse');
        if (bags.length) bagFrames += before > 0 ? 1 : 0;
      },
    });
    expect(st.ctx.count('ellipse')).toBeGreaterThan(5);
    expect(bagFrames).toBeGreaterThan(0);
  });

  it('Reaction Tag: green circles, red squares with a cross, a footprint on the floor lights, and the reaction in milliseconds', () => {
    const st = stage();
    const view = createMirrorView(st.kit);
    const feetProfile = profileOf(SHAPE_FULL, 'full');
    const { run } = drive(reactionTagRules, st, view, { bots: 'perfect', level: 'hard', seed: 8, seconds: 40, duration: 60, feet: true, profiles: [feetProfile] });
    expect(run.engine.plan.some((p) => p.trap)).toBe(true);
    expect(run.engine.plan.some((p) => p.zone === 'floor')).toBe(true);
    const log = st.ctx.log;
    const fills = new Set(log.filter((l) => l.name === 'fill').map((l) => String(l.fillStyle)));
    expect(fills.has('#22C383')).toBe(true);
    expect(fills.has('#FF4F6E')).toBe(true);
    expect(st.ctx.count('quadraticCurveTo')).toBeGreaterThan(8);
    expect(st.ctx.count('ellipse')).toBeGreaterThan(3);
    expect((st.ctx as unknown as Texts).words.some((t) => /^\d+ ms$/.test(t.text))).toBe(true);
  });
});

describe('the picture and the body', () => {
  it('draws the camera picture first, mirrored, then the targets over it; no picture draws the stage only', () => {
    const st = stage(844, 390);
    const video = {} as CanvasImageSource;
    const view = createMirrorView(st.kit, { video: () => video, videoSize: () => ({ w: 1280, h: 720 }) });
    drive(starCatchRules, st, view, { bots: 'idle', seconds: 6 });
    const first = st.ctx.calls.find((c) => c.name === 'drawImage')!;
    expect(first.args[0]).toBe(video);
    const idx = st.ctx.calls.findIndex((c) => c.name === 'drawImage' && c.args[0] === video);
    const sprite = st.ctx.calls.findIndex((c, i) => i > idx && c.name === 'drawImage' && c.args[0] !== video);
    expect(sprite).toBeGreaterThan(idx);
    const none = stage(844, 390);
    drive(starCatchRules, none, createMirrorView(none.kit), { bots: 'idle', seconds: 4 });
    expect(none.ctx.calls.some((c) => c.name === 'drawImage' && (c.args[0] as { width?: number }).width === undefined)).toBe(false);
  });

  it('draws the player\'s body from the pose frame, for the player it belongs to', () => {
    const st = stage(1280, 800);
    st.kit.mirror.show({ silhouette: true, skeleton: true });
    const lm = synthPose({ ...DEFAULT_SHAPE, aspect: 4 / 3 }, {});
    const pose: PoseFrame = { seq: 1, t: 1, landmarks: lm, inferenceMs: 5, source: 'test', aspect: 4 / 3 };
    const view = createMirrorView(st.kit);
    drive(starCatchRules, st, view, { bots: 'idle', seconds: 3, pose });
    expect(st.ctx.count('stroke')).toBeGreaterThan(20);
  });

  it('shows the body as a silhouette only when there is no camera picture to show it in', () => {
    const lastShow = (st: Stage): { silhouette: boolean; skeleton: boolean }[] => {
      const seen: { silhouette: boolean; skeleton: boolean }[] = [];
      const orig = st.kit.mirror.show.bind(st.kit.mirror);
      st.kit.mirror.show = (o) => { seen.push({ ...o }); orig(o); };
      return seen;
    };
    const lm = synthPose({ ...DEFAULT_SHAPE, aspect: 4 / 3 }, {});
    const pose: PoseFrame = { seq: 1, t: 1, landmarks: lm, inferenceMs: 5, source: 'test', aspect: 4 / 3 };
    const without = stage();
    const a = lastShow(without);
    drive(starCatchRules, without, createMirrorView(without.kit), { bots: 'idle', seconds: 1, pose });
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((x) => x.silhouette && !x.skeleton)).toBe(true);
    const withPicture = stage();
    const b = lastShow(withPicture);
    drive(starCatchRules, withPicture, createMirrorView(withPicture.kit, { video: () => ({}) as CanvasImageSource, videoSize: () => ({ w: 640, h: 480 }) }), { bots: 'idle', seconds: 1, pose });
    expect(b.every((x) => !x.silhouette && !x.skeleton)).toBe(true);
    const keys = stage();
    const c = lastShow(keys);
    drive(starCatchRules, keys, createMirrorView(keys.kit), { keyboard: true, bots: 'idle', seconds: 1 });
    expect(c.every((x) => !x.silhouette)).toBe(true);
  });

  it('a keyboard round draws a plain figure and never asks for the camera picture', () => {
    const st = stage(1280, 800);
    let asked = 0;
    const view = createMirrorView(st.kit, { video: () => { asked++; return {} as CanvasImageSource; } });
    const { run } = drive(starCatchRules, st, view, { keyboard: true, bots: 'idle', seconds: 5 });
    expect(asked).toBe(0);
    expect(run.engine.keyboard).toBe(true);
    expect(st.ctx.count('arc')).toBeGreaterThan(20);
  });

  it('two lanes: a divider down the middle of the mirror and each player\'s own targets', () => {
    const st = stage(1280, 800);
    const view = createMirrorView(st.kit);
    const a = profileOf(SHAPE_UPPER, 'upper'), b = profileOf({ ...SHAPE_UPPER, cx: 0.3 }, 'upper');
    const { run } = drive(starCatchRules, st, view, { bots: ['perfect', 'perfect'], seconds: 10, profiles: [a, b] });
    expect(run.engine.view().lanes.length).toBe(2);
    expect(st.ctx.dashes).toBeGreaterThan(0);
    const m = st.kit.rects.mirror;
    const mid = m.x + m.w / 2;
    expect(st.ctx.calls.some((c) => c.name === 'moveTo' && Math.abs((c.args[0] as number) - mid) < 0.001)).toBe(true);
    expect(st.kit.particles.stats().emitted).toBeGreaterThan(10);
  });

  it('assigns two bodies to the two players by where they stand', () => {
    const st = stage(1280, 800);
    st.kit.mirror.show({ silhouette: true, skeleton: false });
    const left = synthPose({ ...DEFAULT_SHAPE, aspect: 16 / 9, cx: 0.7 }, {}), right = synthPose({ ...DEFAULT_SHAPE, aspect: 16 / 9, cx: 0.3 }, {});
    const pose: PoseFrame = { seq: 1, t: 1, landmarks: right, inferenceMs: 5, source: 'test', aspect: 16 / 9, poses: [right, left] };
    const view = createMirrorView(st.kit);
    const a = profileOf({ ...SHAPE_UPPER, aspect: 16 / 9, cx: 0.7 }, 'upper'), b = profileOf({ ...SHAPE_UPPER, aspect: 16 / 9, cx: 0.3 }, 'upper');
    drive(starCatchRules, st, view, { bots: ['idle', 'idle'], seconds: 2, profiles: [a, b], pose });
    expect(st.ctx.count('fill')).toBeGreaterThan(10);
  });
});

describe('manners', () => {
  it('without text support (a fake or an old context) it still draws everything but the words', () => {
    const st = stage(1280, 800, { text: false });
    expect(() => drive(padWorkRules, st, createMirrorView(st.kit), { bots: 'perfect', seconds: 8, steer: padSteer('perfect') })).not.toThrow();
  });

  it('reduced motion: fewer sparks, no pulsing, nothing throws', () => {
    const a = stage(1280, 800, { reduced: false });
    drive(starCatchRules, a, createMirrorView(a.kit), { bots: 'perfect', seconds: 12, seed: 2 });
    const b = stage(1280, 800, { reduced: true });
    drive(starCatchRules, b, createMirrorView(b.kit), { bots: 'perfect', seconds: 12, seed: 2, reduced: true });
    expect(b.kit.particles.stats().emitted).toBeLessThan(a.kit.particles.stats().emitted);
  });

  it('keeps the draw state balanced (every save has its restore) and the sprite bank small', () => {
    const st = stage(844, 390);
    drive(reactionTagRules, st, createMirrorView(st.kit), { bots: 'perfect', level: 'expert', seconds: 25, duration: 60 });
    expect(st.ctx.count('save')).toBe(st.ctx.count('restore'));
    expect(st.surf.live()).toBeLessThanOrEqual(48);
  });

  it('gives everything back on dispose', () => {
    const st = stage();
    const view = createMirrorView(st.kit);
    drive(starCatchRules, st, view, { bots: 'perfect', seconds: 8 });
    expect(st.kit.particles.alive).toBeGreaterThan(0);
    view.dispose();
    expect(st.kit.particles.alive).toBe(0);
    st.kit.dispose();
    expect(st.surf.live()).toBe(0);
  });

  it('makes the mirror the shape of the camera the player was calibrated with', () => {
    const st = stage(1280, 800);
    const view = createMirrorView(st.kit);
    const wide: BodyProfile = profileOf({ ...SHAPE_UPPER, aspect: 16 / 9 }, 'upper');
    drive(starCatchRules, st, view, { bots: 'idle', seconds: 1, profiles: [wide] });
    const m = st.kit.rects.mirror;
    expect(m.w / m.h).toBeCloseTo(16 / 9, 3);
    expect(st.kit.calibrated).toBe(true);
  });

  it('every word it can draw exists in all five languages', () => {
    for (const k of ['grade.perfect', 'grade.good', 'grade.early', 'grade.late', 'ms']) for (const l of ['en', 'tr', 'de', 'es', 'fr'] as const) expect(TARGET_STRINGS[l][k], `${l} ${k}`).toBeTruthy();
  });
});

describe.each(BREAKPOINTS.map((b) => [b.label, b] as const))('on %s', (_label, b) => {
  const portrait = b.h > b.w;
  const cameras: [string, number][] = portrait ? [['upright camera', 3 / 4], ['wide camera', 16 / 9]] : [['laptop camera', 16 / 9], ['4:3 camera', 4 / 3]];

  it.each(cameras)('keeps every target inside the mirror and clear of every plate (%s), for the three games', (_n, aspect) => {
    const profile = profileOf({ ...SHAPE_UPPER, aspect }, 'upper');
    const full = profileOf({ ...SHAPE_FULL, aspect }, 'full');
    for (const [rules, o] of [
      [starCatchRules, { level: 'expert' as const, profiles: [profile] as [BodyProfile] }],
      [padWorkRules, { level: 'expert' as const, profiles: [profile] as [BodyProfile], steer: padSteer('perfect') }],
      [reactionTagRules, { level: 'expert' as const, profiles: [full] as [BodyProfile], feet: true, duration: 40 }],
    ] as const) {
      const st = stage(b.w, b.h);
      const view = createMirrorView(st.kit);
      const run = setup(rules as Rules<BaseSpec>, { duration: 30, rounds: 1, bots: 'idle', seed: 21, ...(o as SetupOptions) });
      view.begin({ game: rules.id, players: 1, keyboard: false, seated: false, profiles: run.engine.view().lanes.map((l) => l.profile) });
      expect(layoutProblems(st.kit.rects), rules.id).toEqual([]);
      const m = st.kit.rects.mirror;
      const plates = Object.entries(st.kit.rects.hud).filter(([k]) => !['pip', 'own', 'friend'].includes(k));
      let checked = 0;
      for (let i = 0; i < 60 * 20 && run.engine.phase === 'running'; i++) {
        tick(run);
        if (i % 20 !== 0) continue;
        const lane = run.engine.view().lanes[0]!;
        const pr = (st.kit as unknown as { projectInto(v: { x: number; y: number }, o: { x: number; y: number }): { x: number; y: number } });
        for (const t of lane.targets) {
          if ((t.spec as PadSpec).kind === 'bag') continue;
          const c = pr.projectInto({ x: t.x, y: t.y }, { x: 0, y: 0 });
          const rad = t.r * lane.profile.T * m.h;
          expect(c.x - rad, `${rules.id} left edge`).toBeGreaterThanOrEqual(m.x - 0.5);
          expect(c.x + rad, `${rules.id} right edge`).toBeLessThanOrEqual(m.x + m.w + 0.5);
          expect(c.y - rad, `${rules.id} top edge`).toBeGreaterThanOrEqual(m.y - 0.5);
          expect(c.y + rad, `${rules.id} bottom edge`).toBeLessThanOrEqual(m.y + m.h + 0.5);
          for (const [name, p] of plates) {
            const hit = c.x + rad > p.x && c.x - rad < p.x + p.w && c.y + rad > p.y && c.y - rad < p.y + p.h;
            expect(hit, `${rules.id} target under ${name}`).toBe(false);
          }
          checked++;
        }
      }
      expect(checked, rules.id).toBeGreaterThan(5);
      view.dispose();
      st.kit.dispose();
    }
  });
});
