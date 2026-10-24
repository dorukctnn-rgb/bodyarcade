// The view of Twist Turbine (template E, design/LAYOUT.md section 5: "the payoff fills the play area"): a night city with a
// wind turbine over it. The turbine's blades turn with the player's twists, a ring around the hub is the power the city is
// given (and in a storm what the storm asks: dots for the twists of a blackout, an arc and a side mark for an overload), the
// city's windows light block by block, and the Mover below twists as the body does. A bar on top shows the pace against the
// band of the level. Nothing here changes the simulation: the view reads it, turns the events since the last frame into
// sparks, and takes cosmetic randomness only from the game's 'fx' stream and cosmetic time only from the simulation's step
// count (a paused game stands still).
//
// Words are never drawn on the canvas: the command, the score and the reasons are the HUD's. The self view sits in a corner
// over the scenery; the avatar, the turbine and the pace bar stay out from under it (ttLayout).
import type { Rect } from '../../core/render2d/view.ts';
import type { GameContext, Rng } from '../../core/types/index.ts';
import type { HostView, SimEvent } from '../_shared/host.ts';
import { drawFigure, mixLimbs, MOVER_NIGHT, STAND, type Limbs } from '../_shared/mover.ts';
import { sceneUnit, type Stage } from '../_shared/stage.ts';
import { clamp, lerp } from '../_shared/util.ts';
import { drawCity, makeCity, type City } from './city.ts';
import type { Geometry } from './fireworks-view.ts';
import type { TurbineSim } from './turbine.ts';

const NIGHT = { top: '#140F27', mid: '#1A1430', low: '#241C40', tower: '#31285A', dim: '#40366E' } as const;
const SUN = '#FFC53A';
const FLUSH = '#FF4F6E';
const CHALK = '#F4F2F8';
const SKY = '#46B4FF';

/** Hands together in front of the chest, and the same swung to the player's right and left (degrees, see mover.ts). */
const CENTER: Readonly<Limbs> = { ...STAND, armUpperL: -105, armLowerL: 25, armUpperR: -75, armLowerR: 155 };
const TO_R: Readonly<Limbs> = { ...STAND, armUpperL: -55, armLowerL: 22, armUpperR: -70, armLowerR: 40 };
const TO_L: Readonly<Limbs> = { ...STAND, armUpperL: -110, armLowerL: 140, armUpperR: -125, armLowerR: 158 };

export interface TtLayout {
  /** The band the city stands in (full width, from the roof line to the bottom of the screen). */
  band: Rect;
  roofY: number;
  /** The turbine's hub and the length of a blade. */
  hub: { x: number; y: number; r: number };
  /** The avatar's hip, one torso length in pixels. */
  avatar: { hipX: number; hipY: number; T: number };
  /** The pace bar. */
  pace: Rect;
  /** Everything that must not sit under the self view. */
  keep: { turbine: Rect; avatar: Rect; pace: Rect };
}

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Where everything stands. Pure, so the layout can be checked on all ten screens without a canvas. */
export function ttLayout(g: Geometry): TtLayout {
  const P = g.play;
  const unit = sceneUnit(g.w, g.h);
  const landscape = P.w > P.h * 1.25;
  const roofY = P.y + P.h * 0.68;
  const band: Rect = { x: 0, y: roofY, w: g.w, h: Math.max(1, g.h - roofY) };
  const paceH = clamp(P.h * 0.034, 8, 20 * unit);
  const paceMax = clamp(P.w * (landscape ? 0.42 : 0.62), 110, 360 * unit);
  // the avatar beside the turbine (landscape) is as tall as the height allows (4.05 torso lengths in a play area that is all its own);
  // below the turbine (portrait) it takes a share of the width
  const baseT = clamp(landscape ? Math.min(P.w * 0.15, P.h * 0.19) : Math.min(P.w, P.h) * 0.15, 20, 80 * unit);

  const make = (T: number, shiftA: number, shiftH: number, rScale: number): TtLayout | null => {
    const acx = P.x + P.w * ((landscape ? 0.7 : 0.5) + shiftA);
    const footY = P.y + P.h - 0.22 * T;
    const hipY = footY - 1.8 * T;
    const avatarBox: Rect = { x: acx - 1.9 * T, y: hipY - 1.95 * T, w: 3.8 * T, h: footY + 0.3 * T - (hipY - 1.95 * T) };
    if (avatarBox.x < P.x || avatarBox.x + avatarBox.w > P.x + P.w) return null;
    const hx = P.x + P.w * ((landscape ? 0.32 : 0.5) + shiftH);
    const paceW = Math.min(paceMax, 2 * Math.min(hx - P.x, P.x + P.w - hx) - 6);
    if (paceW < 100) return null;
    const pace: Rect = { x: hx - paceW / 2, y: P.y + P.h * 0.025, w: paceW, h: paceH };
    const top = pace.y + pace.h + P.h * 0.03;
    const bottom = landscape ? P.y + P.h * 0.97 : avatarBox.y - P.h * 0.012;
    const r = rScale * Math.min(P.w * (landscape ? 0.22 : 0.3), (bottom - top) / 2 / 1.45);
    if (r < 34) return null;
    if (hx - 1.45 * r < P.x || hx + 1.45 * r > P.x + P.w) return null;
    const hy = (top + bottom) / 2;
    // the disc of the blades with the side mark on both sides of it
    const turbine: Rect = { x: hx - 1.45 * r, y: hy - 1.12 * r, w: 2.9 * r, h: 2.24 * r };
    if (landscape && overlaps(turbine, avatarBox)) return null;
    return { band, roofY, hub: { x: hx, y: hy, r }, avatar: { hipX: acx, hipY, T }, pace, keep: { turbine, avatar: avatarBox, pace } };
  };

  const shiftsA = landscape ? [0, -0.1, 0.1, -0.18, 0.18] : [0, -0.16, 0.16, -0.28, 0.28];
  const shiftsH = [0, -0.1, 0.1, -0.2, 0.2];
  let T = baseT;
  let first: TtLayout | null = null;
  for (let tries = 0; tries < 6; tries++) {
    for (const rs of [1, 0.82, 0.66]) {
      for (const sh of shiftsH) {
        for (const sa of shiftsA) {
          const L = make(T, sa, sh, rs);
          if (!L) continue;
          first ||= L;
          if (!g.pip || (!overlaps(L.keep.avatar, g.pip) && !overlaps(L.keep.turbine, g.pip) && !overlaps(L.keep.pace, g.pip))) return L;
        }
      }
    }
    T *= 0.88;
  }
  if (first) return first;
  // a very small play area: stand in the middle, the self view may cover scenery
  const T0 = clamp(Math.min(P.w, P.h) * 0.1, 12, 40);
  const cx = P.x + P.w / 2, footY = P.y + P.h - 0.22 * T0, hipY = footY - 1.8 * T0;
  const r = Math.max(10, Math.min(P.w * 0.25, P.h * 0.2));
  const pace: Rect = { x: P.x + P.w * 0.2, y: P.y + P.h * 0.02, w: P.w * 0.6, h: paceH };
  return {
    band, roofY, hub: { x: cx, y: P.y + P.h * 0.4, r }, avatar: { hipX: cx, hipY, T: T0 }, pace,
    keep: { turbine: { x: cx - 1.12 * r, y: P.y + P.h * 0.4 - 1.12 * r, w: 2.24 * r, h: 2.24 * r }, avatar: { x: cx - 1.9 * T0, y: hipY - 1.95 * T0, w: 3.8 * T0, h: 2.25 * T0 + 1.8 * T0 }, pace },
  };
}

export function createTurbineView(ctx: GameContext, stage: Stage, o: { reducedMotion: boolean }): HostView<TurbineSim> {
  const fx: Rng = ctx.rng('fx');
  const city: City = makeCity(fx);
  const stars = Array.from({ length: 40 }, () => ({ x: fx(), y: fx() * 0.55, r: 0.6 + fx() * 1.0, ph: fx() * 6.28 }));
  const rain = Array.from({ length: 48 }, () => ({ x: fx(), y: fx(), s: 0.7 + fx() * 0.6 }));
  let layout: TtLayout | null = null;
  let layoutKey = '';
  let sky: CanvasGradient | null = null;
  let skyKey = '';
  let lastT = -1;
  /** Blade angle in turns (the view's own: capped, so that a fast turbine never strobes). */
  let spin = 0;
  /** The body's twist, -1 (left) to 1 (right), eased. */
  let tw = 0;
  /** How dark the storm makes the night, 0..1, eased. */
  let dark = 0;
  let stormy = 0;
  let flash = 0;
  let twinkleT = 0;

  const layoutFor = (): TtLayout => {
    const pip = stage.pip;
    const key = `${stage.w}x${stage.h}|${stage.play.x},${stage.play.y},${stage.play.w},${stage.play.h}|${pip ? `${pip.x},${pip.y},${pip.w},${pip.h}` : '-'}`;
    if (key !== layoutKey || !layout) {
      layoutKey = key;
      layout = ttLayout({ w: stage.w, h: stage.h, play: stage.play, pip, lanes: stage.lanes });
    }
    return layout;
  };

  function drawSky(c: Stage['ctx'], L: TtLayout, viewT: number, lit: number): void {
    const key = `${stage.w}x${stage.h}`;
    if (!sky || key !== skyKey) {
      skyKey = key;
      sky = c.createLinearGradient(0, 0, 0, stage.h);
      sky.addColorStop(0, NIGHT.top);
      sky.addColorStop(0.55, NIGHT.mid);
      sky.addColorStop(1, NIGHT.low);
    }
    c.fillStyle = sky;
    c.fillRect(0, 0, stage.w, stage.h);
    c.fillStyle = CHALK;
    for (const s of stars) {
      c.globalAlpha = (o.reducedMotion ? 0.5 : 0.3 + 0.3 * Math.sin(viewT * 0.8 + s.ph)) * (1 - 0.7 * dark);
      c.fillRect(s.x * stage.w, s.y * stage.h, s.r * stage.unit, s.r * stage.unit);
    }
    c.globalAlpha = 1;
    // a warm glow over the roofs that grows with the share of the city that is lit
    if (lit > 0.05) {
      const g = c.createLinearGradient(0, L.roofY - stage.h * 0.2, 0, L.roofY + stage.h * 0.04);
      g.addColorStop(0, 'rgba(255, 197, 58, 0)');
      g.addColorStop(1, 'rgba(255, 197, 58, 0.16)');
      c.globalAlpha = clamp(lit, 0, 1);
      c.fillStyle = g;
      c.fillRect(0, L.roofY - stage.h * 0.2, stage.w, stage.h * 0.24);
      c.globalAlpha = 1;
    }
  }

  function drawTower(c: Stage['ctx'], L: TtLayout): void {
    const { x, y, r } = L.hub;
    const base = L.band.y + L.band.h;
    c.fillStyle = NIGHT.tower;
    c.beginPath();
    c.moveTo(x - r * 0.05, y);
    c.lineTo(x + r * 0.05, y);
    c.lineTo(x + r * 0.11, base);
    c.lineTo(x - r * 0.11, base);
    c.closePath();
    c.fill();
  }

  function drawBlades(c: Stage['ctx'], L: TtLayout, turns: number): void {
    const { x, y, r } = L.hub;
    c.fillStyle = CHALK;
    for (let i = 0; i < 3; i++) {
      c.save();
      c.translate(x, y);
      c.rotate((turns + i / 3) * Math.PI * 2);
      c.beginPath();
      c.moveTo(0, -r * 0.065);
      c.quadraticCurveTo(r * 0.45, -r * 0.1, r, -r * 0.012);
      c.lineTo(r, r * 0.018);
      c.quadraticCurveTo(r * 0.4, r * 0.075, 0, r * 0.065);
      c.closePath();
      c.fill();
      c.restore();
    }
    c.fillStyle = FLUSH;
    c.beginPath();
    c.arc(x, y, r * 0.08, 0, Math.PI * 2);
    c.fill();
  }

  /** The ring around the hub: the power, or in a storm what the storm asks. */
  function drawRing(c: Stage['ctx'], L: TtLayout, sim: TurbineSim, viewT: number): void {
    const { x, y, r } = L.hub;
    const ringR = r * 1.14;
    const w = Math.max(2.5, r * 0.045);
    const p = sim.playerState;
    const storm = sim.storm;
    c.lineCap = 'round';
    c.lineWidth = w;
    c.strokeStyle = NIGHT.dim;
    c.beginPath();
    c.arc(x, y, ringR, 0, Math.PI * 2);
    c.stroke();
    if (storm && storm.kind === 'blackout') {
      // one dot for each twist the blackout asks for
      const n = Math.max(1, storm.need);
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
        const done = i < sim.stormProgress;
        c.fillStyle = done ? SUN : NIGHT.dim;
        c.beginPath();
        c.arc(x + Math.cos(a) * ringR, y + Math.sin(a) * ringR, w * (done ? 1.5 : 1.1), 0, Math.PI * 2);
        c.fill();
      }
      return;
    }
    if (storm && storm.kind === 'overload') {
      const u = clamp(sim.stormProgress / Math.max(1, storm.holdSteps), 0, 1);
      // the arc fills from the side that is to be held, round the ring
      const dir = storm.side;
      const a0 = dir < 0 ? Math.PI : 0;
      c.strokeStyle = FLUSH;
      if (u > 0.002) {
        c.beginPath();
        c.arc(x, y, ringR, a0, a0 + Math.PI * 2 * u);
        c.stroke();
      }
      // the side mark: a triangle that points to the side and breathes
      const breathe = o.reducedMotion ? 0 : 0.06 * Math.sin(viewT * 7);
      const tipX = x + dir * (ringR + r * (0.36 + breathe)), baseX = x + dir * (ringR + r * 0.1), half = r * 0.15;
      c.fillStyle = FLUSH;
      c.beginPath();
      c.moveTo(tipX, y);
      c.lineTo(baseX, y - half);
      c.lineTo(baseX, y + half);
      c.closePath();
      c.fill();
      return;
    }
    if (p.power > 0.004) {
      c.strokeStyle = SUN;
      c.beginPath();
      c.arc(x, y, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(p.power, 0, 1));
      c.stroke();
    }
  }

  /** The pace bar: the band of the level in sun, and where the player's pace is now. */
  function drawPace(c: Stage['ctx'], L: TtLayout, sim: TurbineSim): void {
    const b = L.pace;
    const [lo, hi] = sim.plan.band;
    const top = hi * 1.4;
    const at = (v: number): number => b.x + b.w * clamp(v / top, 0, 1);
    const working = sim.segment.kind === 'work';
    c.globalAlpha = working ? (sim.storm ? 0.4 : 1) : 0.35;
    c.fillStyle = NIGHT.dim;
    c.fillRect(b.x, b.y, b.w, b.h);
    c.fillStyle = SUN;
    c.globalAlpha *= 0.9;
    c.fillRect(at(lo), b.y, at(hi) - at(lo), b.h);
    c.globalAlpha = working ? (sim.storm ? 0.4 : 1) : 0.35;
    const mx = at(sim.rate);
    const mw = Math.max(3, b.h * 0.34);
    c.fillStyle = CHALK;
    c.fillRect(mx - mw / 2, b.y - b.h * 0.35, mw, b.h * 1.7);
    c.globalAlpha = 1;
  }

  function drawRain(c: Stage['ctx'], viewT: number, amount: number): void {
    if (amount < 0.02) return;
    const u = stage.unit;
    c.strokeStyle = CHALK;
    c.lineWidth = 1.2 * u;
    c.globalAlpha = 0.28 * amount;
    c.beginPath();
    const W = stage.w, H = stage.h;
    const fall = o.reducedMotion ? 0 : viewT;
    for (const d of rain) {
      const x = ((d.x * W - fall * 70 * d.s) % W + W) % W;
      const y = ((d.y * H + fall * 520 * d.s) % H + H) % H;
      c.moveTo(x, y);
      c.lineTo(x - 5 * u, y + 16 * u);
    }
    c.stroke();
    c.globalAlpha = 1;
  }

  return {
    draw(sim, events: readonly SimEvent[], alpha): void {
      const viewT = (sim.k + alpha) / 60;
      const dt = lastT < 0 ? 0 : clamp(viewT - lastT, 0, 0.1);
      lastT = viewT;
      const L = layoutFor();
      const p = sim.playerState;
      const seg = sim.segment;
      const storm = sim.storm;
      for (const e of events) {
        if (e.type === 'rep') {
          const inBand = e['inBand'] === true;
          stage.burst(L.hub.x, L.hub.y, inBand ? 12 : 6, { speed: [60, 190], life: [0.5, 0.9], size: [1.4, 2.6], gravity: 60, drag: 1.1, colors: inBand ? [SUN, CHALK] : [CHALK, SKY], shape: ['dot', 'spark'] });
        } else if (e.type === 'storm') {
          if (!o.reducedMotion) flash = e['kind'] === 'overload' ? 0.32 : 0.18;
        } else if (e.type === 'stormEnd' && e['ok'] === true) {
          stage.burst(L.hub.x, L.hub.y, 36, { speed: [90, 280], life: [0.8, 1.4], size: [1.6, 3], gravity: 90, drag: 1.1, colors: [SUN, CHALK, SKY], shape: ['spark', 'star'] });
        } else if (e.type === 'finale') {
          stage.burst(L.hub.x, L.hub.y, 70, { speed: [100, 340], life: [1, 1.8], size: [1.8, 3.4], gravity: 100, drag: 1.1, colors: [SUN, FLUSH, CHALK, SKY], shape: ['spark', 'star', 'dot'] });
          if (!o.reducedMotion) flash = 0.18;
        }
      }

      // the body's twist: the camera's channel when it is there and fresh, else the side of the last repetition or the key held
      const h = p.hist.length ? p.hist[p.hist.length - 1] : undefined;
      const fresh = !!h && sim.k - h[0] <= 18;
      const target = seg.kind !== 'work' ? 0 : fresh && h ? clamp(h[1] / 0.85, -1, 1) : p.held !== 0 ? p.held * 0.9 : p.side * 0.85;
      tw += (target - tw) * (1 - Math.exp(-dt * 11));
      const blackout = storm?.kind === 'blackout';
      dark += ((blackout ? 0.5 : 0) - dark) * (1 - Math.exp(-dt * 4));
      stormy += ((storm ? 1 : 0) - stormy) * (1 - Math.exp(-dt * 3));
      spin += Math.min(p.omega * 2.2, o.reducedMotion ? 0.6 : 2.2) * dt;
      spin -= Math.floor(spin);

      const c = stage.ctx;
      stage.begin();
      drawSky(c, L, viewT, p.lit);
      drawTower(c, L);
      drawCity(c, city, L.band, p.lit);
      if (dark > 0.01) {
        c.globalAlpha = dark;
        c.fillStyle = '#0B0818';
        c.fillRect(0, 0, stage.w, stage.h);
        c.globalAlpha = 1;
      }
      if (stormy > 0.01 && !blackout) {
        c.globalAlpha = 0.16 * stormy;
        c.fillStyle = '#3A1230';
        c.fillRect(0, 0, stage.w, stage.h);
        c.globalAlpha = 1;
      }
      drawBlades(c, L, spin);
      drawRing(c, L, sim, viewT);

      // the avatar: hands together, swung to the side the body is twisted to; the shoulders narrow as it turns
      const A = L.avatar;
      const resting = seg.kind !== 'work';
      const limbs = resting ? STAND : tw >= 0 ? mixLimbs(CENTER, TO_R, tw) : mixLimbs(CENTER, TO_L, -tw);
      drawFigure(c, { x: A.hipX, y: A.hipY, T: A.T, limbs, span: 1 - 0.28 * Math.abs(tw), alpha: resting ? 0.75 : 1 }, MOVER_NIGHT);

      drawPace(c, L, sim);
      drawRain(c, viewT, stormy * (blackout ? 0.6 : 1));

      // the outro: the city twinkles over its roofs
      if (seg.kind === 'finale' && viewT - twinkleT > 0.22) {
        twinkleT = viewT;
        stage.burst(L.band.x + fx() * L.band.w, L.roofY + fx() * L.band.h * 0.3, 5, { speed: [20, 90], life: [0.6, 1.1], size: [1.2, 2.4], gravity: -10, drag: 1.4, colors: [SUN, CHALK], shape: ['dot', 'spark'] });
      }
      stage.advance(dt);
      stage.drawParticles();
      if (flash > 0.01) {
        c.globalAlpha = flash;
        c.fillStyle = CHALK;
        c.fillRect(0, 0, stage.w, stage.h);
        c.globalAlpha = 1;
        flash *= Math.exp(-dt * 7);
      }
    },
    reset(): void { lastT = -1; spin = 0; tw = 0; dark = 0; stormy = 0; flash = 0; twinkleT = 0; stage.clearParticles(); },
    dispose(): void { layout = null; sky = null; },
  };
}
