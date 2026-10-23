// PoseFeed: frames to the players' engines and the hub, the gate (tech.md 4.1), and mode 'local2'.
import { describe, expect, it } from 'vitest';
import type { BodyProfile, PlayerSlot, PoseFrame } from '../types/index.ts';
import { createCalibrator } from '../body/calibrator.ts';
import { createPlayerAssignment } from '../body/players.ts';
import { createTwoPlayerCalibrator } from '../body/calibrator2.ts';
import { gaussian, mulberry32 } from '../loop/rng.ts';
import { absentBetween, combine, jumpAt, squatAt, synthPose, synthTrace, type BodyShape, type Motion } from '../pose/synth.ts';
import { traceFrames } from '../pose/trace.ts';
import { createInputHub } from './hub.ts';
import { createPoseFeed, type PresenceChange } from './pose-feed.ts';

const RUNNER = [{ id: 'jump' as const }, { id: 'squat' as const }, { id: 'lean' as const }];

function soloFrames(motion: Motion, durationMs = 6000): PoseFrame[] {
  return traceFrames(synthTrace({ id: 'feed', durationMs, fps: 30, seed: 4, motion }));
}

/** Calibrates on the first frames (standing still); returns the profile and the index of the first frame after it. */
function calibrateSolo(fs: readonly PoseFrame[]): { profile: BodyProfile; from: number } {
  const c = createCalibrator({ now: () => 0 });
  c.begin('full');
  for (let i = 0; i < fs.length; i++) if (c.push(fs[i] as PoseFrame).ready) return { profile: c.profile() as BodyProfile, from: i + 1 };
  throw new Error('did not calibrate');
}

const ASPECT = 16 / 9;
const body = (cx: number): BodyShape => ({ cx, hipY: 0.55, T: 0.18, W: 0.14, aspect: ASPECT });

/** Two people (raw x 0.72 is the left of the mirror view: Player 1), each with a motion, MediaPipe order shuffled. */
function twoFrames(m1: Motion, m2: Motion, ms: number, hz = 30): PoseFrame[] {
  const rng = mulberry32(9);
  const out: PoseFrame[] = [];
  for (let t = 0; t <= ms; t += 1000 / hz) {
    const people = [{ shape: body(0.72), p: m1(t) }, { shape: body(0.28), p: m2(t) }].filter((q) => !q.p.absent);
    const poses = people.map((q) => synthPose(q.shape, q.p).map((l) => ({ ...l, x: l.x + gaussian(rng) * 0.0015, y: l.y + gaussian(rng) * 0.0015 })));
    if (rng() < 0.5) poses.reverse();
    out.push({ seq: out.length, t, landmarks: poses[0] ?? null, poses, inferenceMs: 30, source: 'test', aspect: ASPECT });
  }
  return out;
}

const still: Motion = () => ({});

describe('PoseFeed, one player', () => {
  it('before a profile it only splits frames: Player 1, no events, gate off', () => {
    const hub = createInputHub();
    const feed = createPoseFeed({ hub });
    feed.use(RUNNER);
    const changes: PresenceChange[] = [];
    feed.onPresence((e) => changes.push(e));
    const fs = soloFrames(combine(jumpAt(2500), absentBetween(3500, 4500)));
    for (const f of fs) expect(feed.push(f).map((p) => p.player)).toEqual([1]);
    expect(hub.sample(1).events).toEqual([]);
    expect(changes).toEqual([]);
    expect(feed.present(1)).toBe(true);
  });

  it("with a profile the engine's events and channels reach the hub as source 'pose'", () => {
    const hub = createInputHub();
    const feed = createPoseFeed({ hub });
    feed.use(RUNNER);
    const fs = soloFrames(combine(jumpAt(2500), squatAt(3600, 0.6)));
    const { profile, from } = calibrateSolo(fs);
    feed.setProfiles({ 1: profile });
    let crouched = 0;
    const ids: string[] = [];
    for (const f of fs.slice(from)) {
      feed.push(f);
      const frame = hub.sample(f.t);
      crouched = Math.max(crouched, frame.channels.crouch ?? 0);
      for (const e of frame.events) { ids.push(e.id); expect(e.source).toBe('pose'); expect(e.player).toBeUndefined(); }
    }
    expect(ids).toEqual(['jump', 'squat']);
    expect(crouched).toBeGreaterThan(0.5);
    expect(hub.sample(fs.at(-1)!.t + 1).players).toBeUndefined();
  });

  it('push(f, { engines: false }) produces no events (calibration and pauses)', () => {
    const hub = createInputHub();
    const feed = createPoseFeed({ hub });
    feed.use(RUNNER);
    const fs = soloFrames(jumpAt(2500));
    const { profile, from } = calibrateSolo(fs);
    feed.setProfiles({ 1: profile });
    for (const f of fs.slice(from)) feed.push(f, { engines: false });
    expect(hub.sample(9999).events).toEqual([]);
  });

  it('the gate: lost after 500 ms without shoulders and hips (tracking no_person), found again when seen', () => {
    const hub = createInputHub();
    const feed = createPoseFeed({ hub });
    feed.use(RUNNER);
    const fs = soloFrames(combine(absentBetween(2600, 2900), absentBetween(3500, 4400)));
    const { profile, from } = calibrateSolo(fs);
    feed.setProfiles({ 1: profile });
    const changes: PresenceChange[] = [];
    feed.onPresence((e) => changes.push(e));
    const tracking: string[] = [];
    for (const f of fs.slice(from)) {
      feed.push(f);
      const tr = hub.sample(f.t).tracking;
      const s = tr.ok ? 'ok' : (tr.code as string);
      if (tracking.at(-1) !== s) tracking.push(s);
    }
    // The 300 ms gap is too short; in the 900 ms gap the player is lost 500 ms after the last sighting (3467 ms).
    expect(changes.map((c) => [c.player, c.present])).toEqual([[1, false], [1, true]]);
    expect(changes[0]!.t).toBeGreaterThanOrEqual(3966);
    expect(changes[0]!.t).toBeLessThan(4000);
    expect(changes[1]!.t).toBeGreaterThanOrEqual(4400);
    expect(tracking).toEqual(['ok', 'no_person', 'ok']);
  });

  it('reset() brings a lost player back (tracking ok) and starts the engine afresh; dispose() disconnects it', () => {
    const hub = createInputHub();
    const feed = createPoseFeed({ hub, lostMs: 300 });
    feed.use(RUNNER);
    const fs = soloFrames(combine(absentBetween(3000, 4000), jumpAt(4800)));
    const { profile, from } = calibrateSolo(fs);
    feed.setProfiles({ 1: profile });
    const rest = fs.slice(from);
    const cut = rest.findIndex((f) => f.t >= 3500);
    for (const f of rest.slice(0, cut)) feed.push(f);
    expect(feed.present(1)).toBe(false);
    expect(hub.sample(3500).tracking).toEqual({ ok: false, code: 'no_person' });
    feed.reset();
    expect(feed.present(1)).toBe(true);
    expect(hub.sample(3501).tracking).toEqual({ ok: true });
    feed.dispose();
    for (const f of rest.slice(cut)) feed.push(f);
    expect(hub.sample(9999).events).toEqual([]);
  });
});

describe("PoseFeed, mode 'local2'", () => {
  function setup(m1: Motion, m2: Motion, ms = 7000) {
    const hub = createInputHub({ players: 2 });
    const assignment = createPlayerAssignment();
    const feed = createPoseFeed({ hub, players: 2, assignment });
    feed.use(RUNNER);
    const cal = createTwoPlayerCalibrator({ now: () => 0 });
    cal.begin('full');
    const fs = twoFrames(m1, m2, ms);
    let from = -1;
    for (let i = 0; i < fs.length; i++) {
      const split = feed.push(fs[i] as PoseFrame);
      expect(split.map((p) => p.player)).toEqual([1, 2]);
      if (cal.push(split as [never, never]).ready) { from = i + 1; break; }
    }
    expect(from).toBeGreaterThan(0);
    feed.setProfiles(cal.profiles() as Record<PlayerSlot, BodyProfile>);
    return { hub, feed, rest: fs.slice(from) };
  }

  it("each player's moves arrive in their own stream, stamped with the player; the top level mirrors Player 1", () => {
    const { hub, feed, rest } = setup(jumpAt(3000), squatAt(3500, 0.6));
    const got: Record<PlayerSlot, string[]> = { 1: [], 2: [] };
    let top: string[] = [];
    for (const f of rest) {
      feed.push(f);
      const frame = hub.sample(f.t);
      for (const s of [1, 2] as const) for (const e of frame.players![s].events) { got[s].push(e.id); expect(e.player).toBe(s); }
      top = top.concat(frame.events.map((e) => e.id));
    }
    expect(got).toEqual({ 1: ['jump'], 2: ['squat'] });
    expect(top).toEqual(['jump']);
  });

  it('a player who leaves is lost alone (player_missing), the other keeps playing', () => {
    const { hub, feed, rest } = setup(still, absentBetween(3000, 4200));
    const changes: PresenceChange[] = [];
    feed.onPresence((e) => changes.push(e));
    let missing2 = false;
    for (const f of rest) {
      feed.push(f);
      const frame = hub.sample(f.t);
      expect(frame.players![1].tracking).toEqual({ ok: true });
      if (!frame.players![2].tracking.ok) { missing2 = true; expect(frame.players![2].tracking.code).toBe('player_missing'); }
    }
    expect(missing2).toBe(true);
    expect(changes.map((c) => [c.player, c.present])).toEqual([[2, false], [2, true]]);
    expect(feed.allPresent()).toBe(true);
  });
});
