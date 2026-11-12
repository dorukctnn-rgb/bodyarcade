// Builds the growth coach's two body twins (packages/web/src/growth/assets/twin-{female,male}.bin) from the MakeHuman
// "hm08" base mesh and its macro targets, which are CC0 1.0 (tools/growth-twin/LICENSES.md). Our own code end to end:
// no MakeHuman program code is used or run. What it does:
//   1. the body group of base.obj (quads), the young female or male macro shape (the three ethnic targets, 1/3 each),
//   2. regions from the CC0 rig weights (torso, neck, head, upper arms, forearms, hands, thighs, calves, feet),
//   3. holes closed (eye sockets), face and hands smoothed into a mannequin (no face detail, mitten hands),
//   4. the tape bands found on the mesh (chest = widest of the bust zone, waist = narrowest, hips = widest, thighs and
//      calves = widest of their zone, upper arms = middle) with their base circumference (convex hull of the section),
//   5. a small binary: header JSON + int16 positions + uint16 triangles + two region ids and weights per vertex.
// Usage: node tools/growth-twin/build.mjs --src <folder with base.obj, the targets and default_weights.mhw>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const src = resolve(argv[argv.indexOf('--src') + 1] ?? '');
const outDir = join(root, 'packages/web/src/growth/assets');
mkdirSync(outDir, { recursive: true });

export const REGIONS = ['torso', 'neck', 'head', 'upperArmL', 'upperArmR', 'forearmL', 'forearmR', 'handL', 'handR', 'thighL', 'thighR', 'calfL', 'calfR', 'footL', 'footR'];
const R = Object.fromEntries(REGIONS.map((r, i) => [r, i]));

function regionOfBone(name) {
  const side = name.endsWith('.L') ? 'L' : name.endsWith('.R') ? 'R' : '';
  if (/^neck0/.test(name)) return 'neck';
  if (/^upperarm/.test(name)) return 'upperArm' + side;
  if (/^(lowerarm|wrist)/.test(name)) return 'forearm' + side;
  if (/^(metacarpal|finger)/.test(name)) return 'hand' + side;
  if (/^upperleg/.test(name)) return 'thigh' + side;
  if (/^lowerleg/.test(name)) return 'calf' + side;
  if (/^(foot|toe)/.test(name)) return 'foot' + side;
  if (/^(spine|pelvis|root|breast|clavicle|shoulder)/.test(name)) return 'torso';
  return 'head';
}

// ---- 1. mesh ----
const objText = readFileSync(join(src, 'base.obj'), 'utf8');
const allPos = [];
const quads = [];
let group = '';
for (const line of objText.split('\n')) {
  if (line.startsWith('v ')) { const [, x, y, z] = line.trim().split(/\s+/); allPos.push([+x, +y, +z]); }
  else if (line.startsWith('g ')) group = line.trim().slice(2);
  else if (line.startsWith('f ') && group === 'body') quads.push(line.trim().split(/\s+/).slice(1).map((t) => parseInt(t, 10) - 1));
}

function buildBase(gender) {
  const pos = allPos.map((p) => [...p]);
  for (const eth of ['african', 'asian', 'caucasian']) {
    const t = readFileSync(join(src, `${eth}-${gender}-young.target`), 'utf8');
    for (const line of t.split('\n')) {
      if (!line || line.startsWith('#')) continue;
      const [i, dx, dy, dz] = line.trim().split(/\s+/).map(Number);
      if (pos[i]) { pos[i][0] += dx / 3; pos[i][1] += dy / 3; pos[i][2] += dz / 3; }
    }
  }
  return pos;
}

const weightsJson = JSON.parse(readFileSync(join(src, 'default_weights.mhw'), 'utf8'));

function build(gender) {
  const pos0 = buildBase(gender);
  const used = new Map();
  const vpos = [];
  const remap = (i) => { let n = used.get(i); if (n === undefined) { n = vpos.length; used.set(i, n); vpos.push(pos0[i].map((c) => c / 10)); } return n; };
  let faces = quads.map((q) => q.map(remap));
  const oldOf = [...used.entries()].sort((a, b) => a[1] - b[1]).map(([o]) => o);
  // regions
  const rw = vpos.map(() => new Float64Array(REGIONS.length));
  for (const [bone, list] of Object.entries(weightsJson.weights)) {
    const r = R[regionOfBone(bone)];
    for (const [vi, w] of list) { const n = used.get(vi); if (n !== undefined) rw[n][r] += w; }
  }
  for (const w of rw) { const s = w.reduce((a, b) => a + b, 0); if (s > 0) for (let k = 0; k < w.length; k++) w[k] /= s; else w[R.torso] = 1; }
  // floor at 0, centred on x and on the hips' z
  const minY = Math.min(...vpos.map((p) => p[1]));
  for (const p of vpos) p[1] -= minY;
  const H = Math.max(...vpos.map((p) => p[1]));
  const hipZ = avg(vpos.filter((p, i) => rw[i][R.torso] > 0.8 && Math.abs(p[1] - 0.5 * H) < 0.03).map((p) => p[2]));
  for (const p of vpos) p[2] -= hipZ;
  // which side is the person's left: MakeHuman .L should be +x
  const leftX = avg(vpos.filter((_, i) => rw[i][R.upperArmL] > 0.8).map((p) => p[0]));
  if (leftX < 0) throw new Error('unexpected handedness');

  // ---- 3. close holes ----
  const edgeCount = new Map();
  const key = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  for (const f of faces) for (let k = 0; k < f.length; k++) { const a = f[k], b = f[(k + 1) % f.length]; edgeCount.set(key(a, b), (edgeCount.get(key(a, b)) ?? 0) + 1); }
  const nextOf = new Map();
  for (const f of faces) for (let k = 0; k < f.length; k++) { const a = f[k], b = f[(k + 1) % f.length]; if (edgeCount.get(key(a, b)) === 1) nextOf.set(b, a); }
  const seen = new Set();
  const tris = [];
  for (const f of faces) { tris.push([f[0], f[1], f[2]]); if (f.length === 4) tris.push([f[0], f[2], f[3]]); }
  let holes = 0;
  for (const start of nextOf.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let v = start;
    while (v !== undefined && !seen.has(v)) { seen.add(v); loop.push(v); v = nextOf.get(v); }
    if (loop.length < 3 || loop.length > 200) continue;
    const c = [0, 1, 2].map((k) => avg(loop.map((i) => vpos[i][k])));
    const ci = vpos.length; vpos.push(c);
    const w = new Float64Array(REGIONS.length); for (const i of loop) for (let k = 0; k < w.length; k++) w[k] += rw[i][k] / loop.length; rw.push(w);
    for (let k = 0; k < loop.length; k++) tris.push([loop[k], loop[(k + 1) % loop.length], ci]);
    holes++;
  }
  // ---- smoothing (Taubin) of the face and the hands, weighted by region so no seam shows ----
  const nb = vpos.map(() => new Set());
  for (const [a, b, c] of tris) { nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b); }
  const amount = rw.map((w, i) => {
    const head = w[R.head], hands = w[R.handL] + w[R.handR], feet = w[R.footL] + w[R.footR];
    // the face only (front of the head), not the skull's outline
    const face = vpos[i][2] > 0.02 && head > 0.3 ? head : head * 0.25;
    return Math.min(1, face + hands * 1.0 + feet * 0.6);
  });
  const smooth = (iters, lambda) => {
    for (let it = 0; it < iters; it++) {
      const next = vpos.map((p, i) => {
        const a = amount[i] * lambda;
        if (a === 0 || nb[i].size === 0) return p;
        const m = [0, 0, 0];
        for (const j of nb[i]) { m[0] += vpos[j][0]; m[1] += vpos[j][1]; m[2] += vpos[j][2]; }
        const n = nb[i].size;
        return [p[0] + a * (m[0] / n - p[0]), p[1] + a * (m[1] / n - p[1]), p[2] + a * (m[2] / n - p[2])];
      });
      for (let i = 0; i < vpos.length; i++) vpos[i] = next[i];
    }
  };
  for (let k = 0; k < 14; k++) { smooth(1, 0.55); smooth(1, -0.58); }
  // the fingers into a mitten: a few plain smoothing passes on the hands only
  const handAmount = rw.map((w) => Math.min(1, w[R.handL] + w[R.handR]));
  for (let it = 0; it < 10; it++) {
    const next = vpos.map((p, i) => {
      const a = handAmount[i] * 0.5;
      if (a === 0) return p;
      const m = [0, 0, 0]; for (const j of nb[i]) { m[0] += vpos[j][0]; m[1] += vpos[j][1]; m[2] += vpos[j][2]; }
      const n = nb[i].size; return [p[0] + a * (m[0] / n - p[0]), p[1] + a * (m[1] / n - p[1]), p[2] + a * (m[2] / n - p[2])];
    });
    for (let i = 0; i < vpos.length; i++) vpos[i] = next[i];
  }

  // ---- 4. joints and bands ----
  const joint = (a, b) => {
    const pts = vpos.filter((_, i) => rw[i][R[a]] >= 0.25 && rw[i][R[b]] >= 0.25);
    if (pts.length < 3) throw new Error(`no joint ${a}-${b}`);
    return [0, 1, 2].map((k) => avg(pts.map((p) => p[k])));
  };
  const J = {
    shoulderL: joint('torso', 'upperArmL'), shoulderR: joint('torso', 'upperArmR'),
    elbowL: joint('upperArmL', 'forearmL'), elbowR: joint('upperArmR', 'forearmR'),
    wristL: joint('forearmL', 'handL'), wristR: joint('forearmR', 'handR'),
    hipL: joint('torso', 'thighL'), hipR: joint('torso', 'thighR'),
    kneeL: joint('thighL', 'calfL'), kneeR: joint('thighR', 'calfR'),
    ankleL: joint('calfL', 'footL'), ankleR: joint('calfR', 'footR'),
    neckLow: joint('torso', 'neck'), neckHigh: joint('neck', 'head'),
  };
  // a torso tape also goes round the tops of the thighs (hips): torso and thigh regions together, never the arms or hands
  const inTorso = (w, reg) => (reg === 'torso' ? w[R.torso] + w[R.thighL] + w[R.thighR] : reg === 'neck' ? w[R.neck] + w[R.torso] + w[R.head] : w[R[reg]]) > 0.6;
  const torsoSlice = (y, reg = 'torso') => vpos.filter((p, i) => inTorso(rw[i], reg) && Math.abs(p[1] - y) < 0.008).map((p) => [p[0], p[2]]);
  // the crotch: the lowest point of the mesh on the middle line (the legs are apart below it)
  const crotchY = Math.min(...vpos.filter((p) => Math.abs(p[0]) < 0.012 && p[1] > 0.3 * H).map((p) => p[1]));
  const circ = (pts2) => hullPerimeter(pts2) * 100;
  const searchY = (lo, hi, pick, reg = 'torso') => {
    let best = null;
    for (let y = lo * H; y <= hi * H; y += 0.004) {
      const s = torsoSlice(y, reg);
      if (s.length < 12) continue;
      const c = circ(s);
      if (!best || (pick === 'max' ? c > best.c : c < best.c)) best = { y, c };
    }
    return best;
  };
  const chest = searchY(0.68, 0.76, 'max');
  const waist = searchY(0.58, 0.66, 'min');
  const hips = searchY(0.45, 0.54, 'max');
  // the neck tape: the narrowest section between the neck's base and the head
  const neck = searchY(J.neckLow[1] / H, J.neckHigh[1] / H, 'min', 'neck');
  const limbSlice = (reg, a, b, t) => {
    const ax = sub(b, a), len = norm(ax), u = ax.map((c) => c / len);
    const c0 = a.map((v, k) => v + ax[k] * t);
    const [e1, e2] = basis(u);
    return vpos.filter((p, i) => rw[i][R[reg]] > 0.6 && Math.abs(dot(sub(p, c0), u)) < 0.008).map((p) => { const d = sub(p, c0); return [dot(d, e1), dot(d, e2)]; });
  };
  const limbBand = (reg, a, b, lo, hi, pick) => {
    let best = null;
    for (let t = lo; t <= hi + 1e-9; t += 0.02) {
      const s = limbSlice(reg, a, b, t);
      if (s.length < 10) continue;
      const c = circ(s);
      if (!best || (pick === 'max' ? c > best.c : c < best.c)) best = { t, c };
    }
    return best;
  };
  const bands = [
    { part: 'neck', kind: 'torso', region: 'neck', y: neck.y, cm: neck.c },
    { part: 'chest', kind: 'torso', region: 'torso', y: chest.y, cm: chest.c },
    { part: 'waist', kind: 'torso', region: 'torso', y: waist.y, cm: waist.c },
    { part: 'hips', kind: 'torso', region: 'torso', y: hips.y, cm: hips.c },
  ];
  for (const s of ['L', 'R']) {
    // the thigh tape sits below the crotch (above it the hips' tape owns the shape)
    const tCrotch = (J['hip' + s][1] - crotchY) / (J['hip' + s][1] - J['knee' + s][1]);
    const th = limbBand('thigh' + s, J['hip' + s], J['knee' + s], Math.max(0.1, tCrotch + 0.06), Math.max(0.35, tCrotch + 0.3), 'max');
    const ca = limbBand('calf' + s, J['knee' + s], J['ankle' + s], 0.15, 0.5, 'max');
    const ua = { t: 0.5, c: circ(limbSlice('upperArm' + s, J['shoulder' + s], J['elbow' + s], 0.5)) };
    bands.push({ part: 'thigh' + s, kind: 'limb', region: 'thigh' + s, from: 'hip' + s, to: 'knee' + s, t: th.t, cm: th.c });
    bands.push({ part: 'calf' + s, kind: 'limb', region: 'calf' + s, from: 'knee' + s, to: 'ankle' + s, t: ca.t, cm: ca.c });
    bands.push({ part: 'upperArm' + s, kind: 'limb', region: 'upperArm' + s, from: 'shoulder' + s, to: 'elbow' + s, t: ua.t, cm: ua.c });
  }

  // ---- 5. binary ----
  const n = vpos.length;
  const min = [0, 1, 2].map((k) => Math.min(...vpos.map((p) => p[k])));
  const max = [0, 1, 2].map((k) => Math.max(...vpos.map((p) => p[k])));
  const scale = [0, 1, 2].map((k) => (max[k] - min[k]) / 65534);
  const pos16 = new Int16Array(n * 3);
  vpos.forEach((p, i) => { for (let k = 0; k < 3; k++) pos16[i * 3 + k] = Math.round((p[k] - min[k]) / scale[k]) - 32767; });
  const idx = new Uint16Array(tris.length * 3);
  tris.forEach((t, i) => { idx[i * 3] = t[0]; idx[i * 3 + 1] = t[1]; idx[i * 3 + 2] = t[2]; });
  const reg = new Uint8Array(n * 4);
  rw.forEach((w, i) => {
    const order = [...w.keys()].sort((a, b) => w[b] - w[a]);
    const a = order[0], b = order[1];
    const s = w[a] + w[b];
    const wa = Math.round((w[a] / s) * 255);
    reg.set([a, b, wa, 255 - wa], i * 4);
  });
  const header = {
    format: 'BAGT', version: 1, base: gender, heightM: H, vertexCount: n, triangleCount: tris.length,
    quant: { min, scale }, regions: REGIONS, joints: J, bands, crotchY,
    source: 'MakeHuman hm08 base mesh + macro targets (CC0 1.0), processed by tools/growth-twin/build.mjs',
  };
  const hjson = Buffer.from(JSON.stringify(header));
  const hlen = Math.ceil(hjson.length / 4) * 4;
  const parts = [Buffer.from('BAGT'), u32(1), u32(hlen), Buffer.concat([hjson, Buffer.alloc(hlen - hjson.length, 32)]), Buffer.from(pos16.buffer), pad4(Buffer.from(idx.buffer)), Buffer.from(reg.buffer)];
  const out = Buffer.concat(parts);
  writeFileSync(join(outDir, `twin-${gender}.bin`), out);
  console.log(gender, { vertices: n, triangles: tris.length, holes, bytes: out.length, heightM: H.toFixed(3), bands: bands.map((b) => `${b.part} ${b.cm.toFixed(1)}`).join(', ') });
}

function u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; }
function pad4(b) { const n = Math.ceil(b.length / 4) * 4; return n === b.length ? b : Buffer.concat([b, Buffer.alloc(n - b.length)]); }
function avg(a) { return a.reduce((s, v) => s + v, 0) / Math.max(1, a.length); }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(a) { return Math.hypot(a[0], a[1], a[2]); }
function basis(u) {
  const h = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = cross(u, h); const l1 = norm(e1); const a = e1.map((c) => c / l1);
  return [a, cross(u, a)];
}
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
export function hullPerimeter(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return 0;
  const crossO = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && crossO(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (const q of [...p].reverse()) { while (upper.length >= 2 && crossO(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  let s = 0; for (let i = 0; i < hull.length; i++) { const a = hull[i], b = hull[(i + 1) % hull.length]; s += Math.hypot(a[0] - b[0], a[1] - b[1]); }
  return s;
}

if (!argv.includes('--src')) { console.error('Usage: node tools/growth-twin/build.mjs --src <folder>'); process.exit(2); }
for (const g of ['female', 'male']) build(g);
