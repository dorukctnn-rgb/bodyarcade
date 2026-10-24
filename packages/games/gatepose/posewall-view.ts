// The view of Pose Wall (template F, design/LAYOUT.md section 5: "your skeleton in the gate is the main view of you; the self view is
// only a check"): a night corridor with walls that grow out of the distance, each with a hole in the shape of a person, and the Mover
// in front of it making the shape the body makes (the detector's ten limbs, or the shape the keys picked). The rim of the next wall's
// hole warms from sun to mint as the body closes in on the shape (the simulation's `live` fit), and turns mint at once when the shape
// has been held long enough (locked in); a wall that was missed turns flush at the verdict and breaks into pieces, one that was
// passed bursts into sparks. At every verdict the picture holds for a quarter of a second (a freeze frame: you in the hole, or the
// limb that hit the wall), unless the player asked for reduced motion. Nothing here changes the simulation: the view reads it, and
// turns the events since the last frame into sparks, rings and shakes (cosmetic randomness only from the game's 'fx' stream,
// cosmetic time only from the simulation's step count).
//
// Words are never drawn on the canvas: the command, the score and the reasons are the HUD's. The self view sits in a corner over the
// scenery; the avatar and the wall at its arrival stay out from under it (pwLayout). A seated player's figure and every hole are
// drawn from the hips up. Two players: one lane each with its own wall (the same shape), a ring under each avatar in the player's
// colour (sun on the left, sky on the right).
import type { Ctx2D } from '../../core/render2d/ctx.ts';
import type { PoseTarget } from '../../core/moves/poses.ts';
import type { GameContext, Rng } from '../../core/types/index.ts';
import type { HostView, SimEvent } from '../_shared/host.ts';
import { MOVER_NIGHT, STAND, drawFigure, mixLimbs, type Limbs, type MoverStyle } from '../_shared/mover.ts';
import type { Stage } from '../_shared/stage.ts';
import { clamp, lerp } from '../_shared/util.ts';
import { approachU, depthScale, PASS_END } from './plan.ts';
import type { PoseWallSim, PwWall } from './posewall.ts';
import { Backdrop, CHALK, FLUSH, MINT, NIGHT, SKY, SUN, makeStars, zoneIn, type Geometry, type Zone } from './scene.ts';

/** The wall in torso lengths around the hip: half the width, the height above the hip and below it. */
export const WALL = { halfW: 2.25, top: 2.75, bottom: 2.15 } as const;
/** The hole's strokes over the avatar's: the margin the body has to fit in. */
const HOLE_FAT = 1.7;
const RIM_FAT = 0.5;
/** The picture holds at a verdict for this long, seconds (not with reduced motion). */
const FREEZE_S = 0.26;
/** Legs of a squat shape: knees out (the hole is lowered by the shape's depth). */
const SQUAT_LEGS = { thighL: -128, thighR: -52, shinL: -88, shinR: -92 } as const;

export interface PwLayout { zones: Zone[] }

/** Where each player's avatar and wall stand. Pure, so the layout can be checked on all ten screens without a canvas. */
export function pwLayout(g: Geometry, players: 1 | 2): PwLayout {
  const areas = players === 2 && g.lanes ? [g.lanes[0], g.lanes[1]] : [g.play];
  return { zones: areas.map((a) => zoneIn(a, g.pip, { halfW: WALL.halfW, above: WALL.top, below: WALL.bottom })) };
}

/** What a shape looks like as a hole: the ten limbs (standing legs for the ones it does not ask for) and how far the hip is let down. */
export function holeOf(shape: PoseTarget): { limbs: Limbs; down: number } {
  const limbs = { ...STAND, ...shape.limbs } as Limbs;
  if (shape.minDrop !== undefined) Object.assign(limbs, SQUAT_LEGS);
  return { limbs, down: shape.minDrop ?? 0 };
}

const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
/** A colour between two #RRGGBB colours. */
export function mixHex(a: string, b: string, u: number): string {
  const x = hex(a), y = hex(b);
  const t = clamp(u, 0, 1);
  const h = (i: number): string => Math.round(lerp(x[i] as number, y[i] as number, t)).toString(16).padStart(2, '0');
  return `#${h(0)}${h(1)}${h(2)}`;
}

/**
 * How big a wall is at progress u, as a share of its size at the arrival. It starts at a third of it and grows nearly in step with
 * the time: a shape has to be read from afar, so the wall is not a speck at first (as a gate is in Limbo Bend, where only the
 * tilt matters). Past the player it rushes up and fades, as every obstacle does (plan.ts).
 */
export function wallScale(u: number): number {
  if (u <= 1) return 0.34 + 0.66 * Math.pow(Math.max(0, u), 1.7);
  return depthScale(u);
}

const holeStyle = (rim: string): MoverStyle => ({ body: rim, head: rim, edge: null, bandL: rim, bandR: rim });
const HOLE_DARK: MoverStyle = holeStyle(NIGHT.hole);
const SLAB = { top: '#4B3D88', bottom: '#2D2356', lip: '#5A4A9E', edge: '#7567C8', seam: '#6A5BB0' } as const;
const PLAYER_RING = [SUN, SKY] as const;

type Look = 'pending' | 'locked' | 'passed' | 'missed' | 'skipped';

interface Ring { x: number; y: number; t0: number; R: number; color: string }
interface Hold { until: number; wallId: number; limbs: Limbs; drop: number }

/** A rectangle with round corners as a path (the kit's context has no roundRect). */
function roundedRect(c: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + k, y);
  c.lineTo(x + w - k, y);
  c.quadraticCurveTo(x + w, y, x + w, y + k);
  c.lineTo(x + w, y + h - k);
  c.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
  c.lineTo(x + k, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - k);
  c.lineTo(x, y + k);
  c.quadraticCurveTo(x, y, x + k, y);
  c.closePath();
}

export function createPoseWallView(ctx: GameContext, stage: Stage, o: { reducedMotion: boolean }): HostView<PoseWallSim> {
  const fx: Rng = ctx.rng('fx');
  const backdrop = new Backdrop(makeStars(fx), o.reducedMotion);
  let layout: PwLayout | null = null;
  let layoutKey = '';
  let lastT = -1;
  /** The eased limbs and hip drop of each avatar. */
  const cur: Limbs[] = [{ ...STAND } as Limbs, { ...STAND } as Limbs];
  const drop = [0, 0];
  const holds: (Hold | null)[] = [null, null];
  const rings: Ring[] = [];
  let shake = 0;
  let flash = 0;

  const layoutFor = (players: 1 | 2): PwLayout => {
    const pip = stage.pip;
    const key = `${stage.w}x${stage.h}|${stage.play.x},${stage.play.y},${stage.play.w},${stage.play.h}|${pip ? `${pip.x},${pip.y},${pip.w},${pip.h}` : '-'}|${stage.lanes ? '2' : '1'}|${players}`;
    if (key !== layoutKey || !layout) {
      layoutKey = key;
      layout = pwLayout({ w: stage.w, h: stage.h, play: stage.play, pip, lanes: stage.lanes }, players);
    }
    return layout;
  };

  function look(sim: PoseWallSim, w: PwWall): Look {
    const ws = sim.wallStates[w.id];
    if (!ws) return 'pending';
    if (ws.done === 1) return 'passed';
    if (ws.done === 2) return 'missed';
    if (ws.done === 3) return 'skipped';
    return ws.locked ? 'locked' : 'pending';
  }

  /** The wall at progress u: the slab, and the hole in it. `glow` (0..1) warms the rim of a pending wall. */
  function drawWall(c: Ctx2D, z: Zone, sim: PoseWallSim, w: PwWall, u: number, state: Look, glow: number, seated: boolean): void {
    const s = wallScale(u);
    const px = z.vx + (z.hipX - z.vx) * s;
    const py = z.vy + (z.hipY - z.vy) * s;
    const T = z.T * s;
    const alpha = u < 1 ? clamp(u * 5, 0, 1) : clamp(1 - (u - 1) / (PASS_END - 1), 0, 1);
    if (alpha <= 0.01 || T < 1.2) return;
    const fade = state === 'skipped' ? 0.4 : state === 'missed' && u > 1 ? 0.6 : 1;
    const x = px - WALL.halfW * T;
    const y = py - WALL.top * T;
    const wd = 2 * WALL.halfW * T;
    const ht = (WALL.top + WALL.bottom) * T;
    c.save();
    c.globalAlpha = alpha * fade;
    // the slab: a lit top, seams, a lip
    const g = c.createLinearGradient(0, y, 0, y + ht);
    g.addColorStop(0, SLAB.top);
    g.addColorStop(1, SLAB.bottom);
    c.fillStyle = g;
    roundedRect(c, x, y, wd, ht, 0.22 * T);
    c.fill();
    c.strokeStyle = SLAB.edge;
    c.lineWidth = Math.max(1, 0.05 * T);
    c.globalAlpha = alpha * fade * 0.7;
    c.stroke();
    c.globalAlpha = alpha * fade * 0.22;
    c.strokeStyle = SLAB.seam;
    c.lineWidth = Math.max(1, 0.035 * T);
    c.beginPath();
    for (const f of [0.28, 0.52, 0.76]) { c.moveTo(x + 0.12 * T, y + ht * f); c.lineTo(x + wd - 0.12 * T, y + ht * f); }
    c.stroke();
    c.globalAlpha = alpha * fade;
    c.fillStyle = SLAB.lip;
    roundedRect(c, x + 0.1 * T, y + 0.1 * T, wd - 0.2 * T, 0.2 * T, 0.1 * T);
    c.fill();
    // the place in a series: one dot for each wall of it, filled up to this one
    if (w.of > 1) {
      for (let i = 0; i < w.of; i++) {
        c.beginPath();
        c.arc(px + (i - (w.of - 1) / 2) * 0.42 * T, y + 0.2 * T, 0.09 * T, 0, Math.PI * 2);
        c.fillStyle = i < w.series ? CHALK : NIGHT.low;
        c.fill();
      }
    }
    // the hole, with its rim
    const shape = sim.shape(w.pose);
    const hole = holeOf(shape);
    const rim = state === 'locked' || state === 'passed' ? MINT : state === 'missed' ? FLUSH : state === 'skipped' ? NIGHT.line : mixHex(SUN, MINT, glow * glow);
    const hy = py + hole.down * T;
    const lit = state === 'locked' || state === 'passed' ? 1.5 * RIM_FAT : RIM_FAT;
    drawFigure(c, { x: px, y: hy, T, limbs: hole.limbs, fat: HOLE_FAT + lit, upperOnly: seated, alpha: alpha * fade }, holeStyle(rim));
    drawFigure(c, { x: px, y: hy, T, limbs: hole.limbs, fat: HOLE_FAT, upperOnly: seated, alpha: alpha * fade }, HOLE_DARK);
    c.restore();
  }

  function addRing(x: number, y: number, t0: number, R: number, color: string): void {
    if (o.reducedMotion) return;
    if (rings.length >= 6) rings.shift();
    rings.push({ x, y, t0, R, color });
  }

  return {
    draw(sim, events: readonly SimEvent[], alpha): void {
      const viewT = (sim.k + alpha) / 60;
      const dt = lastT < 0 ? 0 : clamp(viewT - lastT, 0, 0.1);
      lastT = viewT;
      const players = sim.playerCount;
      const L = layoutFor(players);
      const seated = sim.variant === 'seated';
      const approachK = sim.plan.approachK;

      for (const e of events) {
        const z = L.zones[Math.min(L.zones.length - 1, Number(e['lane'] ?? 0))] as Zone;
        if (e.type === 'wall' && e['skipped'] !== true) {
          const ok = e['ok'] === true;
          const lane = Math.min(L.zones.length - 1, Number(e['lane'] ?? 0));
          const cx = z.hipX;
          const cy = z.hipY - 0.4 * z.T;
          if (ok) {
            stage.burst(cx, cy, e['perfect'] === true ? 34 : 20, {
              speed: [80, 300], life: [0.5, 1.1], size: [1.6, 3.2], gravity: 140, drag: 1.2, colors: [MINT, CHALK, SUN], shape: ['spark', 'dot', 'star'],
            });
            addRing(cx, cy, viewT, 2.6 * z.T, MINT);
          } else {
            // the wall breaks on the player: pieces of slab, from the whole width of it
            for (const side of [-1, 0, 1]) {
              stage.burst(cx + side * 1.3 * z.T, cy - 0.6 * z.T, 14, {
                speed: [90, 330], life: [0.6, 1.2], size: [2, 4.2], gravity: 460, drag: 0.8, spin: [-6, 6], colors: [SLAB.top, SLAB.lip, SLAB.edge, FLUSH], shape: ['square', 'dot'],
              });
            }
            addRing(cx, cy, viewT, 2.2 * z.T, FLUSH);
            if (!o.reducedMotion) { shake = Math.max(shake, 8); flash = 0.16; }
          }
          if (!o.reducedMotion) holds[lane] = { until: viewT + FREEZE_S, wallId: Number(e['id']), limbs: { ...(cur[lane] as Limbs) }, drop: drop[lane] as number };
        } else if (e.type === 'lock') {
          stage.burst(z.hipX, z.hipY - 1.2 * z.T, 10, { speed: [60, 180], life: [0.3, 0.7], size: [1.4, 2.6], gravity: 80, drag: 1.4, colors: [MINT, CHALK], shape: ['spark', 'dot'] });
        } else if (e.type === 'series') {
          stage.burst(z.hipX, z.hipY - 2.4 * z.T, 26, { speed: [90, 280], life: [0.8, 1.4], size: [1.8, 3.2], gravity: 90, drag: 1.1, colors: [SUN, CHALK, MINT, SKY], shape: ['star', 'spark'] });
        } else if (e.type === 'team') {
          for (const zz of L.zones) stage.burst(zz.hipX, zz.hipY - 2.2 * zz.T, 24, { speed: [90, 300], life: [0.8, 1.4], size: [1.8, 3.2], gravity: 90, drag: 1.1, colors: [SUN, SKY, CHALK], shape: ['star', 'spark'] });
        } else if (e.type === 'finale') {
          for (const zz of L.zones) stage.burst(zz.hipX, zz.hipY - 2 * zz.T, 50, { speed: [100, 340], life: [1, 1.8], size: [1.8, 3.4], gravity: 100, drag: 1.1, colors: [SUN, FLUSH, CHALK, MINT, SKY], shape: ['spark', 'star', 'dot'] });
        }
      }

      // the avatars follow the body (not while the picture holds)
      for (let i = 0; i < L.zones.length; i++) {
        const p = sim.playerStates[i];
        if (!p) continue;
        const hold = holds[i];
        if (hold && viewT >= hold.until) holds[i] = null;
        if (holds[i]) continue;
        const target = sim.segment.kind === 'work' || sim.segment.kind === 'finale' ? (p.limbs as Limbs) : (STAND as Limbs);
        cur[i] = mixLimbs(cur[i] as Limbs, target, 1 - Math.exp(-dt * 16));
        drop[i] = (drop[i] as number) + ((sim.segment.kind === 'work' ? p.drop : 0) - (drop[i] as number)) * (1 - Math.exp(-dt * 12));
      }

      const c = stage.ctx;
      stage.begin();
      c.save();
      if (shake > 0.2) {
        c.translate(Math.sin(viewT * 61) * shake, Math.cos(viewT * 47) * shake * 0.6);
        shake *= Math.exp(-dt * 9);
      }
      backdrop.draw(c, stage.w, stage.h, L.zones.map((z) => ({ x: z.vx, y: z.vy, area: z.area })), viewT);

      const resting = sim.segment.kind === 'rest';
      const k = sim.k + alpha;
      // the walls, far ones first, each in its own lane
      for (let i = 0; i < L.zones.length; i++) {
        const z = L.zones[i] as Zone;
        const p = sim.playerStates[i];
        const next = sim.nextWall(i as 0 | 1);
        const hold = holds[i];
        const live: { w: PwWall; u: number }[] = [];
        for (const w of sim.wallsOf(i as 0 | 1)) {
          const u = approachU(k, w.arriveK, approachK);
          if (u > 0 && u < PASS_END) live.push({ w, u });
        }
        live.sort((a, b) => a.u - b.u);
        const two = L.zones.length > 1;
        if (two) { c.save(); c.beginPath(); c.rect(z.area.x, 0, z.area.w, stage.h); c.clip(); }
        for (const { w, u } of live) {
          const held = hold && hold.wallId === w.id;
          const glow = next && next.id === w.id && p ? p.live : 0;
          drawWall(c, z, sim, w, held ? Math.min(u, 1) : u, look(sim, w), glow, seated);
        }
        if (two) c.restore();
      }

      // the players
      for (let i = 0; i < L.zones.length; i++) {
        const z = L.zones[i] as Zone;
        const p = sim.playerStates[i];
        const hold = holds[i];
        const limbs = hold ? hold.limbs : (cur[i] as Limbs);
        const dy = (hold ? hold.drop : (drop[i] as number)) * z.T;
        if (players === 2) {
          c.save();
          c.globalAlpha = 0.65;
          c.strokeStyle = PLAYER_RING[i] ?? SUN;
          c.lineWidth = Math.max(2, 0.07 * z.T);
          c.beginPath();
          c.ellipse(z.hipX, z.hipY + 1.9 * z.T, 1.05 * z.T, 0.2 * z.T, 0, 0, Math.PI * 2);
          c.stroke();
          c.restore();
        }
        const away = !!p && !p.seen;
        drawFigure(c, { x: z.hipX, y: z.hipY + dy, T: z.T, limbs, upperOnly: seated, alpha: away ? 0.3 : resting ? 0.75 : 1 }, MOVER_NIGHT);
      }
      c.restore();

      // the rings of the verdicts
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i] as Ring;
        const age = (viewT - r.t0) / 0.5;
        if (age >= 1 || age < 0) { rings.splice(i, 1); continue; }
        c.save();
        c.globalAlpha = 0.8 * (1 - age);
        c.strokeStyle = r.color;
        c.lineWidth = Math.max(1.5, 5 * (1 - age));
        c.beginPath();
        c.arc(r.x, r.y, r.R * (0.3 + 0.7 * age), 0, Math.PI * 2);
        c.stroke();
        c.restore();
      }

      stage.advance(dt);
      stage.drawParticles();
      if (flash > 0.01) {
        c.globalAlpha = flash;
        c.fillStyle = FLUSH;
        c.fillRect(0, 0, stage.w, stage.h);
        c.globalAlpha = 1;
        flash *= Math.exp(-dt * 8);
      }
    },
    reset(): void {
      lastT = -1;
      for (const l of cur) Object.assign(l, STAND);
      drop[0] = drop[1] = 0;
      holds[0] = holds[1] = null;
      rings.length = 0;
      shake = 0;
      flash = 0;
      stage.clearParticles();
    },
    dispose(): void { layout = null; rings.length = 0; },
  };
}
