// The view of Limbo Bend (template F, design/LAYOUT.md section 5: "your skeleton in the gate is the main view of you; the self
// view is only a check"): a night corridor with tilted gates that grow out of the distance, and the Mover in front of it, leaning
// with the body (the detector's angle, or the keyboard's lever) with its arms up when they are. A gate that has been held long
// enough turns mint (locked in), one that was missed turns flush at the arrival; the ones that go by fade as they pass over the
// player. Nothing here changes the simulation: the view reads it, and turns the events since the last frame into sparks (cosmetic
// randomness only from the game's 'fx' stream, cosmetic time only from the simulation's step count).
//
// Words are never drawn on the canvas: the command, the score and the reasons are the HUD's. The self view sits in a corner over
// the scenery; the avatar and the gate frame at its arrival stay out from under it (lbLayout).
import type { GameContext, Rng } from '../../core/types/index.ts';
import type { HostView, SimEvent } from '../_shared/host.ts';
import { drawFigure, mixLimbs, MOVER_NIGHT, STAND } from '../_shared/mover.ts';
import type { Stage } from '../_shared/stage.ts';
import { clamp } from '../_shared/util.ts';
import type { LbGate, LimboSim } from './limbo.ts';
import { approachU, depthScale, PASS_END } from './plan.ts';
import { Backdrop, CHALK, FLUSH, MINT, NIGHT, SUN, makeStars, zoneIn, type Geometry, type Zone } from './scene.ts';

const RAD = Math.PI / 180;

export interface LbLayout { zones: Zone[] }

/** Where each player's avatar stands. Pure, so the layout can be checked on all ten screens without a canvas. */
export function lbLayout(g: Geometry, players: 1 | 2): LbLayout {
  const areas = players === 2 && g.lanes ? [g.lanes[0], g.lanes[1]] : [g.play];
  return { zones: areas.map((a) => zoneIn(a, g.pip, { halfW: 2.0, above: 3.3, below: 1.8 })) };
}

export function createLimboView(ctx: GameContext, stage: Stage, o: { reducedMotion: boolean }): HostView<LimboSim> {
  const fx: Rng = ctx.rng('fx');
  const backdrop = new Backdrop(makeStars(fx), o.reducedMotion);
  let layout: LbLayout | null = null;
  let layoutKey = '';
  let lastT = -1;
  /** The eased lean of each avatar (degrees) and how far its arms are up (0..1). */
  const lean = [0, 0];
  const arms = [0, 0];
  let shake = 0;
  let flash = 0;

  const layoutFor = (players: 1 | 2): LbLayout => {
    const pip = stage.pip;
    const key = `${stage.w}x${stage.h}|${stage.play.x},${stage.play.y},${stage.play.w},${stage.play.h}|${pip ? `${pip.x},${pip.y},${pip.w},${pip.h}` : '-'}|${stage.lanes ? '2' : '1'}|${players}`;
    if (key !== layoutKey || !layout) {
      layoutKey = key;
      layout = lbLayout({ w: stage.w, h: stage.h, play: stage.play, pip, lanes: stage.lanes }, players);
    }
    return layout;
  };

  /** The frame of a gate at progress u: the doorway the body has to fit, tilted about the hip. */
  function drawGate(c: Stage['ctx'], z: Zone, g: LbGate, u: number, color: string, state: 'pending' | 'locked' | 'missed' | 'skipped'): void {
    const s = depthScale(u);
    const px = z.vx + (z.hipX - z.vx) * s;
    const py = z.vy + (z.hipY - z.vy) * s;
    const T = z.T * s;
    const alpha = u < 1 ? clamp(u * 4, 0, 1) : clamp(1 - (u - 1) / (PASS_END - 1), 0, 1);
    if (alpha <= 0.01 || T < 1) return;
    const top = g.tall ? 2.85 : 2.15;
    c.save();
    c.translate(px, py);
    c.rotate(g.target * RAD);
    c.globalAlpha = alpha * (state === 'skipped' ? 0.4 : 1);
    c.strokeStyle = color;
    c.lineWidth = Math.max(1.5, 0.2 * T);
    c.lineJoin = 'round';
    c.strokeRect(-1.2 * T, -top * T, 2.4 * T, (top + 0.4) * T);
    // the axis the body has to lie along, and for a tall gate two chevrons: hands up
    c.lineWidth = Math.max(1, 0.05 * T);
    c.globalAlpha = alpha * 0.45;
    c.beginPath();
    c.moveTo(0, 0.4 * T);
    c.lineTo(0, -top * T);
    c.stroke();
    if (g.tall) {
      c.globalAlpha = alpha;
      c.lineWidth = Math.max(1.5, 0.1 * T);
      c.lineCap = 'round';
      c.beginPath();
      for (const dy of [0.55, 0.9]) {
        c.moveTo(-0.35 * T, (-top - dy + 0.35) * T);
        c.lineTo(0, (-top - dy) * T);
        c.lineTo(0.35 * T, (-top - dy + 0.35) * T);
      }
      c.stroke();
    }
    c.restore();
  }

  function colorOf(sim: LimboSim, g: LbGate): { color: string; state: 'pending' | 'locked' | 'missed' | 'skipped' } {
    const gs = sim.gateStates[g.id];
    if (!gs) return { color: SUN, state: 'pending' };
    if (gs.done === 1 || gs.locked) return { color: MINT, state: 'locked' };
    if (gs.done === 2) return { color: FLUSH, state: 'missed' };
    if (gs.done === 3) return { color: NIGHT.line, state: 'skipped' };
    return { color: SUN, state: 'pending' };
  }

  return {
    draw(sim, events: readonly SimEvent[], alpha): void {
      const viewT = (sim.k + alpha) / 60;
      const dt = lastT < 0 ? 0 : clamp(viewT - lastT, 0, 0.1);
      lastT = viewT;
      const players = sim.playerCount;
      const L = layoutFor(players);
      const approachK = sim.plan.approachK;
      for (const e of events) {
        if (e.type === 'gate' && e['skipped'] !== true) {
          const z = L.zones[Math.min(L.zones.length - 1, Number(e['lane'] ?? 0))] as Zone;
          const ok = e['ok'] === true;
          stage.burst(z.hipX, z.hipY - 1.3 * z.T, ok ? (Number(e['precision']) >= 0.8 ? 30 : 16) : 12, {
            speed: [70, ok ? 260 : 170], life: [0.5, 1], size: [1.6, 3], gravity: 120, drag: 1.2, colors: ok ? [MINT, CHALK, SUN] : [FLUSH, '#9C2E4B'], shape: ['spark', 'dot'],
          });
          if (!ok && !o.reducedMotion) { shake = Math.max(shake, 7); flash = 0.14; }
        } else if (e.type === 'team') {
          for (const z of L.zones) stage.burst(z.hipX, z.hipY - 2 * z.T, 24, { speed: [90, 300], life: [0.8, 1.4], size: [1.8, 3.2], gravity: 90, drag: 1.1, colors: [SUN, CHALK, MINT], shape: ['star', 'spark'] });
        } else if (e.type === 'finale') {
          for (const z of L.zones) stage.burst(z.hipX, z.hipY - 2 * z.T, 50, { speed: [100, 340], life: [1, 1.8], size: [1.8, 3.4], gravity: 100, drag: 1.1, colors: [SUN, FLUSH, CHALK, MINT], shape: ['spark', 'star', 'dot'] });
        }
      }

      for (let i = 0; i < L.zones.length; i++) {
        const p = sim.playerStates[i];
        if (!p) continue;
        lean[i] = (lean[i] as number) + ((sim.segment.kind === 'work' ? p.theta : 0) - (lean[i] as number)) * (1 - Math.exp(-dt * 14));
        arms[i] = (arms[i] as number) + ((p.armsUp && sim.segment.kind === 'work' ? 1 : 0) - (arms[i] as number)) * (1 - Math.exp(-dt * 12));
      }

      const c = stage.ctx;
      stage.begin();
      c.save();
      if (shake > 0.2) {
        c.translate(Math.sin(viewT * 61) * shake, Math.cos(viewT * 47) * shake * 0.6);
        shake *= Math.exp(-dt * 9);
      }
      backdrop.draw(c, stage.w, stage.h, L.zones.map((z) => ({ x: z.vx, y: z.vy, area: z.area })), viewT);

      const resting = sim.segment.kind !== 'work';
      const k = sim.k + alpha;
      // gates on the way (behind the player), far ones first
      for (let i = 0; i < L.zones.length; i++) {
        const z = L.zones[i] as Zone;
        const live: { g: LbGate; u: number }[] = [];
        for (const g of sim.gatesOf(i as 0 | 1)) {
          const u = approachU(k, g.arriveK, approachK);
          if (u > 0 && u < 1) live.push({ g, u });
        }
        live.sort((a, b) => a.u - b.u);
        for (const { g, u } of live) { const col = colorOf(sim, g); drawGate(c, z, g, u, col.color, col.state); }
      }

      // the players
      for (let i = 0; i < L.zones.length; i++) {
        const z = L.zones[i] as Zone;
        const ang = 90 - (lean[i] as number);
        const base = { ...STAND, torso: ang, neck: ang };
        const raised = { ...base, armUpperL: ang + 8, armUpperR: ang - 8, armLowerL: ang + 8, armLowerR: ang - 8 };
        drawFigure(c, { x: z.hipX, y: z.hipY, T: z.T, limbs: mixLimbs(base, raised, arms[i] as number), alpha: resting ? 0.75 : 1 }, MOVER_NIGHT);
      }

      // gates that are going by, over the player, fading
      for (let i = 0; i < L.zones.length; i++) {
        const z = L.zones[i] as Zone;
        for (const g of sim.gatesOf(i as 0 | 1)) {
          const u = approachU(k, g.arriveK, approachK);
          if (u >= 1 && u < PASS_END) { const col = colorOf(sim, g); drawGate(c, z, g, u, col.color, col.state); }
        }
      }
      c.restore();

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
    reset(): void { lastT = -1; lean[0] = lean[1] = 0; arms[0] = arms[1] = 0; shake = 0; flash = 0; stage.clearParticles(); },
    dispose(): void { layout = null; },
  };
}
