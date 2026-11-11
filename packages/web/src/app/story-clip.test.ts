// The vertical clip: its timeline (the score counts up, the badge, the cheer, the end), the figure's poses for every game's move, the
// frames it paints (the site's name small on every one, the words of the page, no camera picture to draw from), and the file made by a
// stand-in recorder on a clock the test moves. The real recorder and the real 3D figure are held in e2e/modes.spec.ts.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LIMB_NAMES } from '../../../games/_shared/mover.ts';
import { CLIP_BRAND, type RecorderCtor, type RecorderLike } from './clip.ts';
import { limbDirection } from './story-figure.ts';
import { cheerPose, movePose, storyMoveOf, type StoryMove } from './story-pose.ts';
import {
  BEATS, CARD_BOX, FIGURE_BOX, SCENE_BOX, STORY_H, STORY_MS, STORY_W, countedScore, fitSize, paintStory, recordStory, storyFileName, storyPhase, storyPoseAt,
  type StoryDeps, type StoryInput,
} from './story-clip.ts';

const MOVES: StoryMove[] = ['squat', 'highKnee', 'jackOpen', 'punch', 'reach', 'twist', 'sideBend', 'pull', 'tPose', 'leanLeft', 'stand'];

describe('the timeline of the clip', () => {
  it('is nine seconds of 9:16', () => {
    expect(STORY_MS).toBe(9000);
    expect(STORY_W / STORY_H).toBeCloseTo(9 / 16, 5);
  });

  it('counts the score up from nothing to all of it, never down, and holds it after', () => {
    expect(countedScore(1240, 0)).toBe(0);
    expect(countedScore(1240, BEATS.countFrom)).toBe(0);
    expect(countedScore(1240, BEATS.countTo)).toBe(1240);
    expect(countedScore(1240, STORY_MS)).toBe(1240);
    let last = -1;
    for (let t = 0; t <= STORY_MS; t += 50) { const n = countedScore(1240, t); expect(n).toBeGreaterThanOrEqual(last); last = n; }
    expect(countedScore(-5, STORY_MS)).toBe(0);
    expect(countedScore(12.6, STORY_MS)).toBe(13);
  });

  it('brings each part in at its moment', () => {
    expect(storyPhase(0).intro).toBe(0);
    expect(storyPhase(BEATS.introEnd).intro).toBe(1);
    expect(storyPhase(BEATS.badge - 1).badge).toBe(0);
    expect(storyPhase(BEATS.badge + 400).badge).toBe(1);
    expect(storyPhase(BEATS.cheerFrom - 1).cheer).toBe(-1);
    expect(storyPhase((BEATS.cheerFrom + BEATS.cheerTo) / 2).cheer).toBeCloseTo(0.5, 5);
    expect(storyPhase(BEATS.outro - 1).outro).toBe(0);
    expect(storyPhase(STORY_MS).outro).toBe(1);
  });

  it('lays the game, the figure and the card out on the picture without leaving it', () => {
    for (const b of [SCENE_BOX, FIGURE_BOX, CARD_BOX]) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(STORY_W);
      expect(b.y + b.h).toBeLessThanOrEqual(STORY_H - 60);   // the site's name has its own strip at the bottom
    }
    // the figure stands in front of the game and above the card
    expect(FIGURE_BOX.y).toBeLessThan(SCENE_BOX.y + SCENE_BOX.h);
    expect(CARD_BOX.y).toBeGreaterThan(FIGURE_BOX.y + FIGURE_BOX.h * 0.9);
  });

  it('names the file after the game and the score', () => {
    expect(storyFileName('squat-flap', 1240.4, 'mp4')).toBe('bodyarcade-squat-flap-1240-vertical.mp4');
    expect(storyFileName('star-catch', -3, 'webm')).toBe('bodyarcade-star-catch-0-vertical.webm');
  });
});

describe('the figure of the clip', () => {
  it('has a move for every game of the catalogue, and a light bounce for anything else', () => {
    for (const m of MOVES) expect(storyMoveOf(m)).toBe(m);
    expect(storyMoveOf('balance')).toBe('stand');
    expect(storyMoveOf(undefined)).toBe('stand');
  });

  it('is always in a pose that can be drawn: every limb a finite angle, the jump low, the forward share between 0 and 1', () => {
    for (const m of MOVES) {
      for (let t = 0; t <= STORY_MS; t += 37) {
        for (const p of [movePose(m, t), storyPoseAt(m, t), storyPoseAt(m, t, 1)]) {
          for (const k of LIMB_NAMES) expect(Number.isFinite(p.limbs[k]), `${m} ${t} ${k}`).toBe(true);
          for (const v of Object.values(p.fwd)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
          expect(p.lift).toBeGreaterThanOrEqual(0);
          expect(p.lift).toBeLessThan(0.5);
          expect(Math.abs(p.twist)).toBeLessThanOrEqual(45);
        }
      }
    }
  });

  it('really moves during the move, stands still for its first moment, and cheers with both hands up when the score is in', () => {
    for (const m of MOVES) {
      const a = storyPoseAt(m, 1000);
      const differs = (b: ReturnType<typeof storyPoseAt>): boolean => LIMB_NAMES.some((k) => Math.abs(a.limbs[k] - b.limbs[k]) > 3 || Math.abs((a.fwd[k] ?? 0) - (b.fwd[k] ?? 0)) > 0.05)
        || Math.abs(a.twist - b.twist) > 3 || Math.abs(a.lift - b.lift) > 0.01;
      const moved = [1100, 1250, 1400, 1600, 1800].some((t) => differs(storyPoseAt(m, t)));
      expect(moved, m).toBe(true);
      expect(storyPoseAt(m, 100).lift).toBe(0);
    }
    const top = cheerPose(0.5);
    expect(top.lift).toBeGreaterThan(0.3);
    // (an angle is the same direction a turn later: the arms go up the short way round)
    const norm = (a: number): number => ((((a % 360) + 540) % 360) - 180);
    expect(norm(top.limbs.armUpperL)).toBeGreaterThan(80);
    expect(norm(top.limbs.armUpperL)).toBeLessThan(140);
    expect(norm(top.limbs.armUpperR)).toBeGreaterThan(40);
    expect(norm(top.limbs.armUpperR)).toBeLessThan(100);
    expect(storyPoseAt('squat', (BEATS.cheerFrom + BEATS.cheerTo) / 2).lift).toBeGreaterThan(0.3);
  });

  it('turns a limb\'s angle into a direction in the picture: right, up, toward the camera', () => {
    const v = new THREE.Vector3();
    expect(limbDirection(0, 0, v).toArray().map((x) => Math.round(x * 100) / 100 + 0)).toEqual([1, 0, 0]);
    expect(limbDirection(90, 0, v).toArray().map((x) => Math.round(x * 100) / 100 + 0)).toEqual([0, 1, 0]);
    expect(limbDirection(-90, 1, v).toArray().map((x) => Math.round(x * 100) / 100 + 0)).toEqual([0, 0, 1]);
    expect(limbDirection(180, 0.5, v).length()).toBeCloseTo(1, 6);
  });
});

/** A 2D context that does nothing but note the words written on it (and how many pictures were drawn on it). */
function pen(): CanvasRenderingContext2D & { texts: string[]; images: number } {
  const texts: string[] = [];
  const state = { font: '10px sans-serif', images: 0 };
  const grad = { addColorStop() {} };
  const target: Record<string, unknown> = {
    texts,
    get images() { return state.images; },
    fillText: (s: string) => { texts.push(String(s)); },
    measureText: (s: string) => ({ width: String(s).length * (Number(/(\d+)px/.exec(state.font)?.[1] ?? 10) * 0.55) }),
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    drawImage: () => { state.images++; },
  };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k as string];
      if (k === 'font') return state.font;
      return () => undefined;
    },
    set(t, k, v) { if (k === 'font') state.font = String(v); else t[k as string] = v; return true; },
  }) as unknown as CanvasRenderingContext2D & { texts: string[]; images: number };
}

const INPUT: StoryInput = {
  text: {
    game: 'Squat Flap', level: 'Normal', unit: 'points in 3:00', stats: [{ value: '3:00', label: 'Time' }, { value: '24', label: 'Reps' }], best: 'New personal best',
    challenge: 'Can you beat 1,240?', cta: `Play free at ${CLIP_BRAND}`, players: null, verdict: null,
  },
  score: 1240, format: (n) => n.toLocaleString('en'), move: 'squat', players: 1, scene: null, reducedMotion: false,
};

describe('a frame of the clip', () => {
  it('has the site\'s name small on every frame, the game and the level from the start, and the count on the card', () => {
    for (const t of [0, 1000, 3000, 6000, 8800]) {
      const c = pen();
      paintStory(c, t, INPUT, null);
      expect(c.texts, `${t}`).toContain(CLIP_BRAND);
      expect(c.texts).toContain('Squat Flap');
      expect(c.texts).toContain('Normal');
    }
    const mid = pen();
    paintStory(mid, 2000, INPUT, null);
    const shown = mid.texts.map((s) => Number(s.replace(/,/g, ''))).filter((n) => Number.isFinite(n) && n > 0 && n < 1240);
    expect(shown.length, 'the score is on its way up at two seconds').toBeGreaterThan(0);
    const end = pen();
    paintStory(end, STORY_MS, INPUT, null);
    expect(end.texts).toContain('1,240');
    expect(end.texts).toContain('New personal best');
    expect(end.texts).toContain('Can you beat 1,240?');
    expect(end.texts).toContain(`Play free at ${CLIP_BRAND}`);
  });

  it('draws the 3D figure\'s picture when there is one, and the flat figure (no picture) when there is none', () => {
    const fig = { width: FIGURE_BOX.w, height: FIGURE_BOX.h } as unknown as CanvasImageSource;
    const a = pen();
    paintStory(a, 3000, INPUT, fig);
    expect(a.images).toBe(1);
    const b = pen();
    paintStory(b, 3000, INPUT, null);
    expect(b.images).toBe(0);
  });

  it('two players: both labels and both scores once counted, and who won', () => {
    const two: StoryInput = { ...INPUT, players: 2, text: { ...INPUT.text, best: null, verdict: 'Player 1 wins', players: [{ label: 'Player 1', score: 900, colour: '#FFC53A', winner: true }, { label: 'Player 2', score: 700, colour: '#46B4FF', winner: false }] } };
    const c = pen();
    paintStory(c, STORY_MS, two, null);
    for (const s of ['Player 1', 'Player 2', '900', '700', 'Player 1 wins', CLIP_BRAND]) expect(c.texts).toContain(s);
  });

  it('shrinks a long name until it fits', () => {
    const measure = (font: string): number => Number(/(\d+)px/.exec(font)?.[1] ?? 0) * 20;
    expect(fitSize(measure, 'x', 54, 620)).toBe(30);
    expect(fitSize(measure, 'x', 54, 2000)).toBe(54);
    expect(fitSize(() => 1e9, 'x', 54, 10)).toBe(12);
  });
});

describe('making the file', () => {
  function deps(o: { failStart?: boolean; empty?: boolean } = {}): { deps: StoryDeps; clock: { t: number }; ticks: (() => void)[]; made: RecorderLike[] } {
    const clock = { t: 0 };
    const ticks: (() => void)[] = [];
    const made: RecorderLike[] = [];
    class Rec implements RecorderLike {
      state: 'inactive' | 'recording' | 'paused' = 'inactive';
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() { made.push(this); }
      static isTypeSupported(): boolean { return true; }
      start(): void { if (o.failStart) throw new Error('no'); this.state = 'recording'; }
      stop(): void { this.state = 'inactive'; if (!o.empty) this.ondataavailable?.({ data: new Blob([new Uint8Array(2048)]) }); this.onstop?.(); }
      pause(): void { this.state = 'paused'; }
      resume(): void { this.state = 'recording'; }
    }
    const d: StoryDeps = {
      Recorder: Rec as unknown as RecorderCtor,
      kind: { mime: 'video/mp4;codecs=avc1', ext: 'mp4' },
      now: () => clock.t,
      every: (fn) => { ticks.push(fn); return () => { const i = ticks.indexOf(fn); if (i >= 0) ticks.splice(i, 1); }; },
      canvas: () => ({ pen: pen(), stream: {} as MediaStream, close() {} }),
    };
    return { deps: d, clock, ticks, made };
  }

  /** Moves the clock in frames until the promise settles. */
  async function drive<T>(p: Promise<T>, x: { clock: { t: number }; ticks: (() => void)[] }): Promise<T> {
    let done = false;
    let out: T | undefined;
    void p.then((v) => { done = true; out = v; });
    for (let i = 0; i < 2000 && !done; i++) {
      x.clock.t += 1000 / 30;
      for (const fn of [...x.ticks]) fn();
      await Promise.resolve();
      await Promise.resolve();
    }
    return out as T;
  }

  it('records nine seconds and hands over an MP4, saying how far it is along the way', async () => {
    const x = deps();
    const seen: number[] = [];
    const file = await drive(recordStory(x.deps, INPUT, null, { progress: (u) => seen.push(u) }), x);
    expect(file).not.toBeNull();
    expect(file?.mime).toBe('video/mp4');
    expect(file?.ext).toBe('mp4');
    expect(file?.seconds).toBe(9);
    expect(file?.blob.size).toBe(2048);
    expect(seen.at(-1)).toBe(1);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(x.made).toHaveLength(1);
    expect(x.ticks).toHaveLength(0);   // nothing is left ticking
  });

  it('asks the figure for a picture at every frame', async () => {
    const x = deps();
    const asked: number[] = [];
    await drive(recordStory(x.deps, INPUT, { frame: (t) => { asked.push(t); return null; } }), x);
    expect(asked.length).toBeGreaterThan(200);
    expect(asked[0]).toBe(0);
    expect(asked.at(-1)).toBe(STORY_MS);
  });

  it('gives no file, and no error, when the recorder cannot start or recorded nothing', async () => {
    const a = deps({ failStart: true });
    expect(await drive(recordStory(a.deps, INPUT, null), a)).toBeNull();
    const b = deps({ empty: true });
    expect(await drive(recordStory(b.deps, INPUT, null), b)).toBeNull();
    const c = deps();
    expect(await drive(recordStory({ ...c.deps, canvas: () => null }, INPUT, null), c)).toBeNull();
  });
});
