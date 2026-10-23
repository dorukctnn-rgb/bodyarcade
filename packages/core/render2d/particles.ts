// Particles for hits, bursts, confetti and fireworks. A fixed pool in typed arrays: nothing is allocated while the game
// runs, a full pool ignores new particles instead of growing, and dead particles are swapped out so the live ones stay
// packed at the front. All randomness comes from the stream the game passes in (its 'fx' stream), so effects never
// shift the course and a replay looks the same.
import type { Rng } from '../types/index.ts';
import type { Ctx2D } from './ctx.ts';

export type ParticleShape = 'dot' | 'square' | 'star' | 'spark';
const SHAPES: readonly ParticleShape[] = ['dot', 'square', 'star', 'spark'];

export interface BurstOptions {
  /** Pixels per second, min and max. */
  speed?: [number, number];
  /** Directions in radians, from and to (default all around). 0 points right, negative up. */
  angle?: [number, number];
  /** Seconds, min and max. */
  life?: [number, number];
  /** Pixels (radius for dots and stars, half side for squares, half length for sparks). */
  size?: [number, number];
  /** Pixels per second squared, downward positive. */
  gravity?: number;
  /** Share of the speed lost per second (0.9 stops a particle in about a second). */
  drag?: number;
  /** Turn speed in radians per second, min and max (squares and stars). */
  spin?: [number, number];
  colors?: readonly string[];
  shape?: ParticleShape | readonly ParticleShape[];
}

export interface ParticleOptions {
  capacity?: number;
  /** 1 = as asked. 0.25 for reduced motion: every burst makes a quarter of the particles. */
  amount?: number;
}

export interface ParticleStats { alive: number; capacity: number; emitted: number; dropped: number }

export interface Particles {
  burst(x: number, y: number, count: number, o?: BurstOptions): number;
  /** Paper falling from a line: a row of confetti across `width` pixels starting at (x, y). */
  confetti(x: number, y: number, width: number, count: number, o?: BurstOptions): number;
  update(dtSeconds: number): void;
  draw(ctx: Ctx2D): void;
  clear(): void;
  setAmount(a: number): void;
  readonly alive: number;
  stats(): ParticleStats;
}

const TAU = Math.PI * 2;
export const DEFAULT_COLORS: readonly string[] = ['#FF4F6E', '#FFC53A', '#46B4FF', '#22C383', '#F4F2F8'];

export function createParticles(rng: Rng, options: ParticleOptions = {}): Particles {
  const cap = options.capacity ?? 600;
  let amount = options.amount ?? 1;
  const x = new Float32Array(cap), y = new Float32Array(cap), vx = new Float32Array(cap), vy = new Float32Array(cap);
  const life = new Float32Array(cap), maxLife = new Float32Array(cap), size = new Float32Array(cap);
  const rot = new Float32Array(cap), spin = new Float32Array(cap), grav = new Float32Array(cap), drag = new Float32Array(cap);
  const shape = new Uint8Array(cap), color = new Uint16Array(cap);
  const palette: string[] = [];
  const paletteIndex = new Map<string, number>();
  let n = 0, emitted = 0, dropped = 0;

  const between = (r: readonly [number, number]): number => r[0] + rng() * (r[1] - r[0]);
  const colorIndex = (c: string): number => {
    let i = paletteIndex.get(c);
    if (i === undefined) { i = palette.length; palette.push(c); paletteIndex.set(c, i); }
    return i;
  };

  function add(px: number, py: number, pvx: number, pvy: number, o: BurstOptions): boolean {
    emitted++;
    if (n >= cap) { dropped++; return false; }
    const i = n++;
    const l = between(o.life ?? [0.5, 1.1]);
    x[i] = px; y[i] = py; vx[i] = pvx; vy[i] = pvy;
    life[i] = l; maxLife[i] = l;
    size[i] = between(o.size ?? [2, 5]);
    rot[i] = rng() * TAU;
    spin[i] = between(o.spin ?? [-6, 6]);
    grav[i] = o.gravity ?? 600;
    drag[i] = o.drag ?? 0.6;
    const shapes = o.shape === undefined ? ['dot' as const] : Array.isArray(o.shape) ? o.shape as readonly ParticleShape[] : [o.shape as ParticleShape];
    shape[i] = SHAPES.indexOf(shapes[Math.floor(rng() * shapes.length)] ?? 'dot');
    const colors = o.colors && o.colors.length ? o.colors : DEFAULT_COLORS;
    color[i] = colorIndex(colors[Math.floor(rng() * colors.length)]!);
    return true;
  }

  return {
    burst(px, py, count, o = {}) {
      const k = Math.max(0, Math.round(count * amount));
      const sp = o.speed ?? [120, 380], an = o.angle ?? [0, TAU];
      let made = 0;
      for (let i = 0; i < k; i++) {
        const a = between(an), s = between(sp);
        if (add(px, py, Math.cos(a) * s, Math.sin(a) * s, o)) made++;
      }
      return made;
    },
    confetti(px, py, width, count, o = {}) {
      const k = Math.max(0, Math.round(count * amount));
      let made = 0;
      for (let i = 0; i < k; i++) {
        if (add(px + rng() * width, py, (rng() - 0.5) * 140, 40 + rng() * 140, { shape: 'square', size: [3, 6], gravity: 220, drag: 1.4, life: [1.6, 2.8], spin: [-10, 10], ...o })) made++;
      }
      return made;
    },
    update(dt) {
      if (!(dt > 0)) return;
      for (let i = 0; i < n;) {
        life[i] = life[i]! - dt;
        if (life[i]! <= 0) {
          // swap with the last live particle: the live ones stay packed at the front
          const j = --n;
          if (i !== j) {
            x[i] = x[j]!; y[i] = y[j]!; vx[i] = vx[j]!; vy[i] = vy[j]!; life[i] = life[j]!; maxLife[i] = maxLife[j]!; size[i] = size[j]!;
            rot[i] = rot[j]!; spin[i] = spin[j]!; grav[i] = grav[j]!; drag[i] = drag[j]!; shape[i] = shape[j]!; color[i] = color[j]!;
          }
          continue;
        }
        const k = Math.exp(-drag[i]! * dt);
        vx[i] = vx[i]! * k;
        vy[i] = vy[i]! * k + grav[i]! * dt;
        x[i] = x[i]! + vx[i]! * dt;
        y[i] = y[i]! + vy[i]! * dt;
        rot[i] = rot[i]! + spin[i]! * dt;
        i++;
      }
    },
    draw(ctx) {
      if (n === 0) return;
      let last = -1;
      for (let i = 0; i < n; i++) {
        const u = life[i]! / maxLife[i]!;
        ctx.globalAlpha = u < 0.35 ? u / 0.35 : 1;
        if (color[i] !== last) { last = color[i]!; ctx.fillStyle = palette[last]!; ctx.strokeStyle = palette[last]!; }
        const s = size[i]! * (0.6 + 0.4 * Math.min(1, u * 2));
        const px = x[i]!, py = y[i]!;
        switch (shape[i]) {
          case 1: {   // square, turned
            const c = Math.cos(rot[i]!) * s, d = Math.sin(rot[i]!) * s;
            ctx.beginPath();
            ctx.moveTo(px - c + d, py - d - c); ctx.lineTo(px + c + d, py + d - c); ctx.lineTo(px + c - d, py + d + c); ctx.lineTo(px - c - d, py - d + c);
            ctx.closePath(); ctx.fill();
            break;
          }
          case 2: {   // five-point star
            ctx.beginPath();
            for (let k = 0; k < 10; k++) {
              const a = rot[i]! + (k * Math.PI) / 5, r = k % 2 ? s * 0.45 : s * 1.25;
              if (k === 0) ctx.moveTo(px + Math.cos(a) * r, py + Math.sin(a) * r); else ctx.lineTo(px + Math.cos(a) * r, py + Math.sin(a) * r);
            }
            ctx.closePath(); ctx.fill();
            break;
          }
          case 3: {   // spark: a short line along its direction of travel
            const sp = Math.hypot(vx[i]!, vy[i]!) || 1;
            const ux = vx[i]! / sp, uy = vy[i]! / sp;
            ctx.beginPath(); ctx.moveTo(px - ux * s * 1.8, py - uy * s * 1.8); ctx.lineTo(px + ux * s * 0.6, py + uy * s * 0.6);
            ctx.lineWidth = Math.max(1, s * 0.5); ctx.lineCap = 'round'; ctx.stroke();
            break;
          }
          default:
            ctx.beginPath(); ctx.arc(px, py, s, 0, TAU); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    },
    clear() { n = 0; },
    setAmount(a) { amount = Math.min(1, Math.max(0, a)); },
    get alive() { return n; },
    stats() { return { alive: n, capacity: cap, emitted, dropped }; },
  };
}
