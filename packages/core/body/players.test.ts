// Player assignment for two players in front of one camera: left of the mirror view is Player 1; identities hold
// when MediaPipe shuffles its output, when players cross, and when one leaves and comes back.
import { describe, expect, it } from 'vitest';
import type { Landmark, PlayerFrame, PoseFrame } from '../types/index.ts';
import { LM } from '../types/index.ts';
import { mulberry32, gaussian } from '../loop/rng.ts';
import { synthPose, type BodyShape } from '../pose/synth.ts';
import { createPlayerAssignment } from './players.ts';

const ASPECT = 16 / 9;
// Two different bodies so a test can tell who is who: Ana is taller than Ben.
const ana = (cx: number): BodyShape => ({ cx, hipY: 0.55, T: 0.2, W: 0.15, aspect: ASPECT });
const ben = (cx: number): BodyShape => ({ cx, hipY: 0.57, T: 0.16, W: 0.12, aspect: ASPECT });
const torso = (lm: Landmark[] | null): number => (lm ? ((lm[LM.leftHip]!.y + lm[LM.rightHip]!.y) - (lm[LM.leftShoulder]!.y + lm[LM.rightShoulder]!.y)) / 2 : 0);
const who = (f: PlayerFrame): 'ana' | 'ben' | null => (f.landmarks ? (torso(f.landmarks) > 0.18 ? 'ana' : 'ben') : null);

function frame(t: number, people: BodyShape[], rng?: () => number): PoseFrame {
  const poses = people.map((s) => synthPose(s).map((p) => (rng ? { ...p, x: p.x + gaussian(rng) * 0.002, y: p.y + gaussian(rng) * 0.002 } : p)));
  if (rng && poses.length === 2 && rng() < 0.5) poses.reverse();   // MediaPipe's order is not stable
  return { seq: Math.round(t / 33), t, landmarks: poses[0] ?? null, poses, inferenceMs: 20, source: 'test', aspect: ASPECT };
}

describe('player assignment', () => {
  it('the player on the left of the mirror view is Player 1 (the right side of the raw camera image)', () => {
    const a = createPlayerAssignment();
    // raw x 0.7 is on the image's right, which the players see on their left in the mirror
    const [p1, p2] = a.push(frame(0, [ben(0.3), ana(0.7)]));
    expect(who(p1)).toBe('ana');
    expect(who(p2)).toBe('ben');
    expect(p1.player).toBe(1);
    expect(p2.player).toBe(2);
    expect(p1.poses).toBeUndefined();
    expect(a.presence[1].present && a.presence[2].present).toBe(true);
  });

  it('a shuffled detector order never swaps the players (300 noisy frames, standing close together)', () => {
    const a = createPlayerAssignment();
    const rng = mulberry32(9);
    for (let i = 0; i < 300; i++) {
      const [p1, p2] = a.push(frame(i * 33, [ana(0.56), ben(0.44)], rng));
      expect([who(p1), who(p2)]).toEqual(['ana', 'ben']);
    }
  });

  it.each(['ana', 'ben'])('players who cross keep their slots, also while one hides the other (%s in front)', (front) => {
    const a = createPlayerAssignment();
    const rng = mulberry32(4);
    const seen: [string | null, string | null][] = [];
    for (let i = 0; i <= 90; i++) {
      const t = i * 33;
      const u = Math.min(1, Math.max(0, (t - 500) / 2000));       // walk past each other between 0.5 s and 2.5 s
      const xa = 0.72 - 0.44 * u, xb = 0.28 + 0.44 * u;
      const hidden = Math.abs(xa - xb) < 0.08;                       // one body covers the other: one detection
      const people = hidden ? [front === 'ana' ? ana(xa) : ben(xb)] : [ana(xa), ben(xb)];
      const [p1, p2] = a.push(frame(t, people, rng));
      seen.push([who(p1), who(p2)]);
    }
    expect(seen[0]).toEqual(['ana', 'ben']);
    expect(seen.at(-1)).toEqual(['ana', 'ben']);                     // Ana is now on the right but still Player 1
    expect(seen.every(([x, y]) => x !== 'ben' && y !== 'ana')).toBe(true);
    expect(a.presence[1].present && a.presence[2].present).toBe(true);
  });

  it('a player who leaves is absent after 500 ms, and takes the same slot on return', () => {
    const a = createPlayerAssignment();
    let t = 0;
    const step = (people: BodyShape[]) => { const r = a.push(frame(t, people)); t += 33; return r; };
    for (let i = 0; i < 10; i++) step([ana(0.7), ben(0.3)]);
    for (let i = 0; i < 10; i++) step([ana(0.7)]);                  // Ben steps out (330 ms): still counted present
    expect(a.presence[2].present).toBe(true);
    for (let i = 0; i < 10; i++) step([ana(0.7)]);                  // now 660 ms
    expect(a.presence[2].present).toBe(false);
    expect(a.presence[2].lastX).toBeCloseTo((1 - 0.3) * ASPECT, 1);
    expect(a.presence[1].present).toBe(true);
    const [p1, p2] = step([ana(0.7), ben(0.25)]);                   // Ben comes back a little further out
    expect([who(p1), who(p2)]).toEqual(['ana', 'ben']);
    expect(a.presence[2]).toMatchObject({ present: true });
  });

  it('one person alone is the player on their side; after everyone left, sides decide again', () => {
    const a = createPlayerAssignment();
    let [p1, p2] = a.push(frame(0, [ben(0.3)]));                     // on the mirror's right
    expect(who(p1)).toBeNull();
    expect(who(p2)).toBe('ben');
    for (let t = 33; t < 1200; t += 33) a.push(frame(t, []));
    expect(a.presence[2].present).toBe(false);
    [p1, p2] = a.push(frame(1300, [ben(0.75)]));                    // back on the mirror's left
    expect(who(p1)).toBe('ben');
    expect(who(p2)).toBeNull();
  });

  it('a lone player stays in their slot when the second player walks in', () => {
    const a = createPlayerAssignment();
    for (let t = 0; t < 500; t += 33) a.push(frame(t, [ana(0.45)]));  // Ana alone, just right of centre in the mirror: Player 2
    const [p1, p2] = a.push(frame(520, [ana(0.45), ben(0.8)]));      // Ben joins on the mirror's left
    expect(who(p2)).toBe('ana');
    expect(who(p1)).toBe('ben');
  });
});
