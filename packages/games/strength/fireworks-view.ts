// The view of Firework Jacks (template E, design/LAYOUT.md section 5: "the payoff fills the play area"): a night sky over a
// city, a launch pad with the Mover on it, a ring of four dots that pulse on the beat, rockets that rise and burst, the city's
// windows lighting with the energy of the play, and at the end the finale. Nothing here changes the simulation: the view
// reads it, and turns the events since the last frame into rockets, ripples and bursts (cosmetic randomness only from the
// game's 'fx' stream, cosmetic time only from the simulation's step count, so a paused game stands still).
//
// Words are never drawn on the canvas: the command, the score and the reasons are the HUD's. The self view of the shell
// sits in a corner over the scenery; the avatar and the pad stay out from under it (fjLayout).
import type { Rect } from '../../core/render2d/view.ts';
import type { GameContext, Rng } from '../../core/types/index.ts';
import type { HostView, SimEvent } from '../_shared/host.ts';
import { drawFigure, JACK_OPEN, MOVER_NIGHT, mixLimbs, STAND } from '../_shared/mover.ts';
import type { Stage } from '../_shared/stage.ts';
import { clamp, lerp } from '../_shared/util.ts';
import { drawCity, makeCity, type City } from './city.ts';
import type { FireworkSim } from './fireworks.ts';

export const FIREWORK_COLORS = ['#FF4F6E', '#FFC53A', '#46B4FF', '#22C383', '#F4F2F8'] as const;
const NIGHT = { top: '#140F27', mid: '#1A1430', low: '#241C40', pad: '#31285A', rim: '#F4F2F8', dim: '#40366E' } as const;

export interface Geometry { w: number; h: number; play: Rect; pip: Rect | null; lanes: readonly [Rect, Rect] | null }

export interface FjZone {
  area: Rect;
  /** The avatar's hip, one torso length in pixels, and the pad it stands on. */
  hipX: number;
  hipY: number;
  T: number;
  padX: number;
  padY: number;
  padRx: number;
  padRy: number;
  /** The four beat dots, centre and radius. */
  dotsY: number;
  dotsX: number;
  dotR: number;
  /** Everything that must not sit under the self view. */
  keep: Rect[];
}

export interface FjLayout {
  /** The band the city stands in (full width, from the roof line to the bottom of the screen). */
  band: Rect;
  roofY: number;
  zones: FjZone[];
}

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Where everything stands. Pure, so the layout can be checked on all ten screens without a canvas. */
export function fjLayout(g: Geometry, players: 1 | 2): FjLayout {
  const zones: FjZone[] = [];
  const areas: Rect[] = players === 2 && g.lanes ? [g.lanes[0], g.lanes[1]] : [g.play];
  const roofY = g.play.y + g.play.h * 0.68;
  for (const area of areas) {
    const u = Math.min(area.w, area.h);
    let T = clamp(u * 0.15, 22, 84);
    let zone: FjZone | null = null;
    for (let tries = 0; tries < 6 && !zone; tries++) {
      for (const shift of [0, -0.16, 0.16, -0.28, 0.28]) {
        const cx = area.x + area.w / 2 + shift * area.w;
        const footY = area.y + area.h - 0.55 * T;
        const hipY = footY - 1.8 * T;
        const box: Rect = { x: cx - 1.75 * T, y: hipY - 2.1 * T, w: 3.5 * T, h: 3.9 * T + 0.5 * T };
        const pad: Rect = { x: cx - 1.5 * T, y: footY - 0.35 * T, w: 3 * T, h: 0.7 * T };
        const dots: Rect = { x: area.x + area.w / 2 - 1.6 * T, y: area.y + 0.04 * area.h, w: 3.2 * T, h: 0.5 * T };
        const keep = [box, pad, dots];
        if (cx - 1.75 * T < area.x || cx + 1.75 * T > area.x + area.w) continue;
        if (g.pip && keep.some((r) => overlaps(r, g.pip as Rect))) continue;
        zone = {
          area, hipX: cx, hipY, T, padX: cx, padY: footY, padRx: 1.35 * T, padRy: 0.3 * T,
          dotsX: area.x + area.w / 2, dotsY: area.y + 0.04 * area.h + 0.25 * T, dotR: Math.max(3, T * 0.11), keep,
        };
        break;
      }
      if (!zone) T *= 0.86;
    }
    // no room beside the self view even when small: stand in the middle, the self view may cover scenery
    if (!zone) {
      const cx = area.x + area.w / 2, footY = area.y + area.h - 0.55 * T, hipY = footY - 1.8 * T;
      zone = {
        area, hipX: cx, hipY, T, padX: cx, padY: footY, padRx: 1.35 * T, padRy: 0.3 * T, dotsX: cx, dotsY: area.y + 0.04 * area.h + 0.25 * T,
        dotR: Math.max(3, T * 0.11), keep: [{ x: cx - 1.75 * T, y: hipY - 2.1 * T, w: 3.5 * T, h: 4.4 * T }],
      };
    }
    zones.push(zone);
  }
  const band: Rect = { x: 0, y: roofY, w: g.w, h: Math.max(1, g.h - roofY) };
  return { band, roofY, zones };
}

interface Rocket {
  x0: number; y0: number; x1: number; y1: number;
  t0: number; dur: number;
  size: number; hue: number; star: boolean; double: boolean; grand: boolean; shells: number;
  /** Where it was a moment ago, for the trail. */
  tx: number; ty: number;
}

interface Ripple { x: number; y: number; t0: number; color: string; r: number }

const ease = (u: number): number => 1 - (1 - u) * (1 - u);

export function createFireworksView(ctx: GameContext, stage: Stage, o: { reducedMotion: boolean }): HostView<FireworkSim> {
  const fx: Rng = ctx.rng('fx');
  const city: City = makeCity(fx);
  const stars = Array.from({ length: 44 }, () => ({ x: fx(), y: fx() * 0.62, r: 0.6 + fx() * 1.1, ph: fx() * 6.28 }));
  let rockets: Rocket[] = [];
  let ripples: Ripple[] = [];
  let lastT = -1;
  let beatT = -10, beatStrong = false, beatN = 0;
  let flash = 0;
  let layout: FjLayout | null = null;
  let layoutKey = '';
  let sky: CanvasGradient | null = null;
  let skyKey = '';

  const layoutFor = (players: 1 | 2): FjLayout => {
    const key = `${stage.w}x${stage.h}|${stage.play.x},${stage.play.y},${stage.play.w},${stage.play.h}|${stage.pip ? `${stage.pip.x},${stage.pip.y},${stage.pip.w},${stage.pip.h}` : '-'}|${stage.lanes ? '2' : '1'}|${players}`;
    if (key !== layoutKey || !layout) {
      layoutKey = key;
      layout = fjLayout({ w: stage.w, h: stage.h, play: stage.play, pip: stage.pip, lanes: stage.lanes }, players);
    }
    return layout;
  };

  const zoneOf = (L: FjLayout, player: number): FjZone => L.zones[Math.min(L.zones.length - 1, Math.max(0, player - 1))] as FjZone;

  function launch(L: FjLayout, e: SimEvent, t: number): void {
    const area = L.zones.length === 2 ? { x: (L.zones[0] as FjZone).area.x, w: (L.zones[1] as FjZone).area.x + (L.zones[1] as FjZone).area.w - (L.zones[0] as FjZone).area.x } : (L.zones[0] as FjZone).area;
    const grand = e['grand'] === true;
    const size = Number(e['size'] ?? 1);
    const x1 = area.x + (grand ? 0.5 : Number(e['x'] ?? 0.5)) * area.w;
    const hue = Number(e['hue'] ?? 0);
    const top = (L.zones[0] as FjZone).area.y;
    const span = L.roofY - top;
    const frac = grand ? 0.34 : 0.22 + 0.2 * ((Number(e['x'] ?? 0.5) * 7.13 + hue * 0.17) % 1) + 0.06 * size;
    const y1 = L.roofY - span * clamp(frac * 1.35, 0.2, 0.9);
    const player = Number(e['player'] ?? 1);
    const z = zoneOf(L, player);
    const x0 = e['type'] === 'burst' ? x1 + (hue - 2) * 6 : lerp(z.padX, x1, 0.12);
    const y0 = e['type'] === 'burst' ? L.roofY - span * 0.02 : z.hipY - z.T * 1.2;
    rockets.push({
      x0, y0, x1, y1, t0: t, dur: grand ? 0.9 : e['type'] === 'burst' ? 0.5 : 0.42 + 0.07 * size,
      size, hue, star: e['star'] === true, double: e['type'] === 'double', grand, shells: Number(e['shells'] ?? 0), tx: x0, ty: y0,
    });
    if (rockets.length > 48) rockets.splice(0, rockets.length - 48);
  }

  function burst(r: Rocket): void {
    const base = FIREWORK_COLORS[r.hue % FIREWORK_COLORS.length] as string;
    const other = FIREWORK_COLORS[(r.hue + 2) % FIREWORK_COLORS.length] as string;
    const palette = r.double ? [base, other, '#F4F2F8'] : [base, base, '#F4F2F8'];
    const n = r.grand ? 120 : r.double ? 70 : r.size >= 3 ? 46 : r.size === 2 ? 26 : 12;
    if (r.star) {
      stage.burst(r.x1, r.y1, 30, { speed: [250, 270], life: [0.9, 1.2], size: [2.5, 4], gravity: 90, drag: 1.1, colors: palette, shape: ['star', 'spark'] });
    }
    stage.burst(r.x1, r.y1, n, {
      speed: r.size >= 3 || r.double || r.grand ? [90, 330] : [60, 220], life: [0.8, 1.5], size: r.size >= 3 ? [1.8, 3.4] : [1.4, 2.6],
      gravity: 140, drag: 1.2, colors: palette, shape: r.size >= 2 ? ['spark', 'dot', 'spark'] : 'dot',
    });
    if (r.grand) {
      for (let i = 0; i < r.shells; i++) {
        stage.burst(r.x1 + (fx() - 0.5) * stage.w * 0.5, r.y1 + (fx() - 0.4) * stage.h * 0.18, 40, { speed: [80, 300], life: [1, 1.8], size: [1.6, 3], gravity: 120, drag: 1.1, colors: FIREWORK_COLORS, shape: ['spark', 'star'] });
      }
      flash = o.reducedMotion ? 0 : 0.2;
    }
    if (r.size >= 2 || r.grand) { try { ctx.audio.play('firework-burst'); } catch { /* no sound */ } }
  }

  function drawSky(c: Stage['ctx'], viewT: number, lit: number): void {
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
    c.fillStyle = '#F4F2F8';
    for (const s of stars) {
      c.globalAlpha = o.reducedMotion ? 0.55 : 0.35 + 0.35 * Math.sin(viewT * 0.9 + s.ph);
      c.fillRect(s.x * stage.w, s.y * stage.h, s.r, s.r);
    }
    c.globalAlpha = 1;
    // a warm glow over the roofs that grows with the energy of the play
    if (lit > 0.05) {
      const g = c.createLinearGradient(0, (layout as FjLayout).roofY - stage.h * 0.2, 0, (layout as FjLayout).roofY + stage.h * 0.04);
      g.addColorStop(0, 'rgba(255, 197, 58, 0)');
      g.addColorStop(1, 'rgba(255, 197, 58, 0.16)');
      c.globalAlpha = clamp(lit, 0, 1);
      c.fillStyle = g;
      c.fillRect(0, (layout as FjLayout).roofY - stage.h * 0.2, stage.w, stage.h * 0.24);
      c.globalAlpha = 1;
    }
  }

  return {
    draw(sim, events, alpha): void {
      const viewT = (sim.k + alpha) / 60;
      const dt = lastT < 0 ? 0 : clamp(viewT - lastT, 0, 0.1);
      lastT = viewT;
      const players = sim.playerCount;
      const L = layoutFor(players);
      for (const e of events) {
        if (e.type === 'jack' && e['grade'] !== 'rest') {
          launch(L, e, viewT);
          const z = zoneOf(L, Number(e['player'] ?? 1));
          if (e['grade'] === 'perfect' || e['grade'] === 'good') {
            ripples.push({ x: z.padX, y: z.padY, t0: viewT, color: e['grade'] === 'perfect' ? '#FFC53A' : '#F4F2F8', r: z.padRx });
            if (ripples.length > 8) ripples.shift();
          }
        } else if (e.type === 'double' || (e.type === 'burst')) launch(L, e, viewT);
        else if (e.type === 'beat') { beatT = viewT; beatStrong = e['strong'] === true; beatN = Number(e['n'] ?? 0); }
      }

      const c = stage.ctx;
      const energy = sim.playerStates.reduce((n, p) => n + p.energy, 0) / Math.max(1, sim.playerStates.length);
      const lit = clamp(0.1 + 0.9 * energy, 0, 1);
      stage.begin();
      drawSky(c, viewT, energy);
      drawCity(c, city, L.band, lit);
      const resting = sim.segment.kind === 'rest';

      // pads, avatars and the beat dots, one set per player
      for (let i = 0; i < L.zones.length; i++) {
        const z = L.zones[i] as FjZone;
        const p = sim.playerStates[i];
        // pad: a flat puck with a chalk rim, and the ring that goes out on the beat
        c.fillStyle = NIGHT.pad;
        c.beginPath();
        c.ellipse(z.padX, z.padY, z.padRx, z.padRy, 0, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = NIGHT.rim;
        c.lineWidth = Math.max(1.5, z.T * 0.05);
        c.globalAlpha = 0.8;
        c.stroke();
        c.globalAlpha = 1;
        const since = viewT - beatT;
        if (sim.segment.kind === 'work' && since >= 0 && since < 0.45) {
          const u = since / 0.45;
          c.strokeStyle = beatStrong ? '#FF4F6E' : '#F4F2F8';
          c.globalAlpha = (1 - u) * 0.7;
          c.lineWidth = Math.max(1.5, z.T * 0.06);
          c.beginPath();
          c.ellipse(z.padX, z.padY, z.padRx * (1 + 0.6 * u), z.padRy * (1 + 0.6 * u), 0, 0, Math.PI * 2);
          c.stroke();
          c.globalAlpha = 1;
        }
        // the avatar: as open as the body is (the camera's channel), or as the last jack was (keys and taps)
        const pulse = p ? Math.exp(-3.2 * Math.max(0, (sim.k + alpha - p.lastJackK) / 60)) : 0;
        const open = clamp(Math.max(p?.open ?? 0, pulse), 0, 1);
        drawFigure(c, { x: z.hipX, y: z.hipY, T: z.T, limbs: mixLimbs(STAND, JACK_OPEN, open), alpha: resting ? 0.75 : 1 }, MOVER_NIGHT);
        // four dots: where in the bar the beat is (the count-in is larger)
        if (sim.segment.kind === 'work') {
          const inBar = beatN % 4;
          for (let d = 0; d < 4; d++) {
            const on = d === inBar && since < 0.5;
            c.fillStyle = on ? (d === 0 ? '#FF4F6E' : '#FFC53A') : NIGHT.dim;
            c.globalAlpha = on ? 1 : 0.55;
            c.beginPath();
            c.arc(z.dotsX + (d - 1.5) * z.dotR * 3.2, z.dotsY, z.dotR * (sim.countingIn ? 1.25 : 1) * (on ? 1.2 : 1), 0, Math.PI * 2);
            c.fill();
          }
          c.globalAlpha = 1;
        }
      }

      // ripples
      ripples = ripples.filter((r) => viewT - r.t0 < 0.5);
      for (const r of ripples) {
        const u = (viewT - r.t0) / 0.5;
        c.strokeStyle = r.color;
        c.globalAlpha = (1 - u) * 0.8;
        c.lineWidth = 2;
        c.beginPath();
        c.ellipse(r.x, r.y, r.r * (1 + 0.9 * u), r.r * 0.3 * (1 + 0.9 * u), 0, 0, Math.PI * 2);
        c.stroke();
      }
      c.globalAlpha = 1;

      // rockets: a bright head and a short trail, then the burst
      const alive: Rocket[] = [];
      for (const r of rockets) {
        const u = (viewT - r.t0) / r.dur;
        if (u >= 1) { burst(r); continue; }
        const e = ease(Math.max(0, u));
        const x = lerp(r.x0, r.x1, e) + Math.sin(u * 9 + r.hue) * 3 * (1 - u), y = lerp(r.y0, r.y1, e);
        const color = FIREWORK_COLORS[r.hue % FIREWORK_COLORS.length] as string;
        c.strokeStyle = color;
        c.lineCap = 'round';
        c.lineWidth = r.size >= 3 ? 3 : 2;
        c.globalAlpha = 0.5;
        c.beginPath();
        c.moveTo(r.tx, r.ty);
        c.lineTo(x, y);
        c.stroke();
        c.globalAlpha = 1;
        c.fillStyle = '#F4F2F8';
        c.beginPath();
        c.arc(x, y, r.size >= 3 ? 3 : 2.2, 0, Math.PI * 2);
        c.fill();
        r.tx = lerp(r.tx, x, 0.4);
        r.ty = lerp(r.ty, y, 0.4);
        alive.push(r);
      }
      rockets = alive;

      stage.advance(dt);
      stage.drawParticles();
      if (flash > 0.01) {
        c.globalAlpha = flash;
        c.fillStyle = '#F4F2F8';
        c.fillRect(0, 0, stage.w, stage.h);
        c.globalAlpha = 1;
        flash *= Math.exp(-dt * 6);
      }
    },
    reset(): void { rockets = []; ripples = []; lastT = -1; beatT = -10; flash = 0; stage.clearParticles(); },
    dispose(): void { rockets = []; ripples = []; layout = null; sky = null; },
  };
}
