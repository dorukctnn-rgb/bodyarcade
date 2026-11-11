// The data of the home page's "how it works" scene (packages/web/src/views/how.ts, app/how-scene.ts): one squat of a real person, as our pose model
// read it, for the two pictures that move together: the body line of the person (left) and the game's character, the Mover (right).
// Both come from the same landmarks of the same frame, so the character moves when the person moves and never on its own.
//
//   node tools/how-loop/make.ts <trace.json> --from=<s> --to=<s> [--out=packages/web/src/how-loop.json]
//
// Used on 11 Nov 2026: the form coach fixture sq-mixkit-52106-front.trace.json (landmarks from Mixkit 52106, Mixkit Stock Video Free
// License; the video itself is not used anywhere), --from=3.0 --to=6.2: standing, one squat, standing.
// - Mirrored as a camera's self view (the person's left on the screen's left) and in square pixels (x times the picture's aspect).
// - A centred 5-frame mean takes the model's jitter out; the last 8 frames blend into the first ones, so the loop has no jump.
// - The points are fitted into the 400x300 picture of the scene, feet on its floor. The scene draws the person's body line and the
//   Mover from the same points of the same frame (the Mover in its own proportions of stroke, the joints where the person's are).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (n: string): string | undefined => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const file = args.find((a) => !a.startsWith('--'));
if (!file) throw new Error('usage: node tools/how-loop/make.ts <trace.json> --from=<s> --to=<s> [--out=<file>]');
const from = Number(flag('from') ?? 0) * 1000;
const to = Number(flag('to') ?? 1e9) * 1000;
const out = resolve(flag('out') ?? 'packages/web/src/how-loop.json');

interface TraceJson { fps: number; aspect: number; meta: { id: string }; frames: { t: number; lm: number[] | null }[] }
const trace = JSON.parse(readFileSync(file, 'utf8')) as TraceJson;

/** MediaPipe landmark numbers, in the order the scene keeps them. */
const POINTS = { nose: 0, shoulderL: 11, shoulderR: 12, elbowL: 13, elbowR: 14, wristL: 15, wristR: 16, hipL: 23, hipR: 24, kneeL: 25, kneeR: 26, ankleL: 27, ankleR: 28 } as const;
const NAMES = Object.keys(POINTS) as (keyof typeof POINTS)[];
type P = { x: number; y: number };

const raw = trace.frames.filter((f) => f.t >= from && f.t <= to);
if (raw.some((f) => !f.lm)) throw new Error('a frame in the window has no person');
// mirrored, square pixels, y down (as the picture)
const frames: P[][] = raw.map((f) => NAMES.map((n) => ({ x: (1 - f.lm![POINTS[n] * 4]!) * trace.aspect, y: f.lm![POINTS[n] * 4 + 1]! })));

const mean = (fs: P[][], i: number, k: number): P => {
  let x = 0, y = 0, n = 0;
  for (let j = Math.max(0, i - 2); j <= Math.min(fs.length - 1, i + 2); j += 1) { x += fs[j]![k]!.x; y += fs[j]![k]!.y; n += 1; }
  return { x: x / n, y: y / n };
};
const smooth = frames.map((f, i) => f.map((_, k) => mean(frames, i, k)));
// The last BLEND frames slide into the first ones (frame 0 follows the last frame of the loop).
const BLEND = 8;
const N = smooth.length;
const loop = smooth.map((f, i) => {
  const into = i - (N - BLEND);
  if (into < 0) return f;
  const a = (into + 1) / (BLEND + 1);
  return f.map((p, k) => ({ x: p.x * (1 - a) + smooth[0]![k]!.x * a, y: p.y * (1 - a) + smooth[0]![k]!.y * a }));
});

// fit the person into the 400x300 picture: feet on the floor (y 268), the head's top under y 30, centred
const W = 400, FLOOR = 268, TOP = 26;
let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
for (const f of loop) for (const p of f) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); }
// the nose is about a head's half below the top of the head: leave room for it
const headR = 0.09 * (maxY - minY);
const s = (FLOOR - TOP) / (maxY - minY + headR * 1.4);
const cx = (minX + maxX) / 2;
const person = loop.map((f) => f.flatMap((p) => [Math.round((W / 2 + (p.x - cx) * s) * 10) / 10, Math.round((FLOOR - (maxY - p.y) * s) * 10) / 10]));

const at = (f: P[], n: keyof typeof POINTS): P => f[NAMES.indexOf(n)]!;

// the bottom of the squat: the frame where the hips are lowest (the game counts the rep there)
const hipY = loop.map((f) => (at(f, 'hipL').y + at(f, 'hipR').y) / 2);
const bottom = hipY.indexOf(Math.max(...hipY));

const data = { source: `${trace.meta.id}, ${from / 1000}-${to / 1000} s`, fps: trace.fps, frames: loop.length, bottom, points: NAMES, person };
writeFileSync(out, `${JSON.stringify(data)}\n`);
console.log(`${out}: ${loop.length} frames, bottom at ${bottom}, ${Math.round(JSON.stringify(data).length / 1024)} KB`);
