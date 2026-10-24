// Limbo Bend on the Game contract: the simulation (limbo.ts), its view (limbo-view.ts), the HUD, the sounds, the keys and swipes,
// and the detector. Two players on one camera (local2) each have a lane with their own gates.
import type { DetectorSpec, GameManifest, KeyMap, TouchMap } from '../../core/types/index.ts';
import { createHostedGame, type HostedGame, type HostSpec } from '../_shared/host.ts';
import { reasonText } from '../_shared/reasons.ts';
import { clamp } from '../_shared/util.ts';
import { LB_TIMING, LimboSim } from './limbo.ts';
import { approachU, type GpTiming } from './plan.ts';
import { createLimboView } from './limbo-view.ts';
import { LB_STRINGS } from './strings.ts';

/**
 * Left and right (arrows or A and D) turn a lever that keeps its angle when released, the opposite key brings it back, Down,
 * S or Space centres it, Up or W holds the arms up (for the tall gates).
 */
export const LB_KEYS: KeyMap = {
  ArrowLeft: { channel: 'leanKey', value: -1 }, a: { channel: 'leanKey', value: -1 },
  ArrowRight: { channel: 'leanKey', value: 1 }, d: { channel: 'leanKey', value: 1 },
  ArrowUp: { channel: 'up', value: 1 }, w: { channel: 'up', value: 1 },
  ArrowDown: { channel: 'center', value: 1 }, s: { channel: 'center', value: 1 }, ' ': { channel: 'center', value: 1 },
};
/** A swipe to a side moves the lever a step (10 degrees) and it stays; a tap or a swipe down centres it; a swipe up holds the arms up for a moment. */
export const LB_TOUCH: TouchMap = {
  left: { channel: 'lean', step: -0.25, min: -1, max: 1 },
  right: { channel: 'lean', step: 0.25, min: -1, max: 1 },
  down: { channel: 'lean', value: 0 },
  tap: { channel: 'lean', value: 0 },
  up: { channel: 'up', value: 1, holdMs: 1600 },
};

/** Every way of playing asks for the side bend detector: sitting needs the same trunk, and a lean makes no noise. */
export function lbDetectors(_v: { seated: boolean; silent: boolean }): DetectorSpec[] {
  return [{ id: 'sideBend' }];
}

/** How a recent miss stays on the reason strip, in steps (1.5 s). */
const HINT_STEPS = 90;

export interface LimboGameOptions {
  /** A shorter run for the end-to-end tests; the game is the same. */
  timing?: Partial<GpTiming>;
}

export function createLimboBendGame(manifest: GameManifest, o: LimboGameOptions = {}): HostedGame<LimboSim> {
  const spec: HostSpec<LimboSim> = {
    manifest,
    english: LB_STRINGS.en,
    makeSim: (setup) => new LimboSim({ setup, met: manifest.met, timing: { ...LB_TIMING, ...o.timing } }),
    makeView: (ctx, stage, opts) => createLimboView(ctx, stage, opts),
    detectors: lbDetectors,

    hud(sim, hud, say, players) {
      const seg = sim.segment;
      if (seg.kind === 'work') {
        const next = players === 1 ? sim.nextGate(0) : null;
        if (!next) hud.set('prompt', { icon: 'sideBend', text: say('lb.prompt.bend') });
        else {
          const key = next.target < 0 ? (next.tall ? 'lb.prompt.leftUp' : 'lb.prompt.left') : (next.tall ? 'lb.prompt.rightUp' : 'lb.prompt.right');
          hud.set('prompt', { icon: 'sideBend', text: say(key), progress: Math.round(clamp(approachU(sim.k, next.arriveK, sim.plan.approachK), 0, 1) * 20) / 20 });
        }
      } else if (seg.kind === 'rest') hud.set('prompt', { icon: 'stand', text: say(sim.gettingReady ? 'lb.prompt.ready' : 'lb.prompt.rest') });
      else hud.set('prompt', { icon: 'sideBend', text: say('lb.prompt.finale') });
      hud.set('timer', Math.ceil(sim.leftS));
      const ps = sim.playerStates;
      for (let i = 0; i < players; i++) {
        const p = ps[i];
        if (!p) continue;
        const text = p.miss && sim.k - p.miss.k < HINT_STEPS ? reasonText(say, p.miss.code) : '';
        if (players === 2) {
          hud.setPlayer((i + 1) as 1 | 2, 'score', p.score);
          hud.setPlayer((i + 1) as 1 | 2, 'hint', text);
        } else {
          hud.set('score', p.score);
          hud.set('combo', p.streak);
          hud.set('hint', text);
        }
      }
    },

    react(events, io) {
      for (const e of events) {
        switch (e.type) {
          case 'lock': io.play('good'); break;
          case 'gate':
            if (e['skipped'] === true) break;
            if (e['ok'] === true) io.play(Number(e['precision']) >= 0.8 ? 'perfect' : 'pass');
            else io.play('miss');
            break;
          case 'team': io.play('star'); break;
          case 'set': io.play('go'); io.hud.announce(io.say('lb.announce.set', { n: Number(e['set']) + 1, of: Number(e['of']), tol: Number(e['tol']) })); break;
          case 'rest': io.play('done'); io.hud.announce(io.say('lb.announce.rest', { n: Number(e['next']) + 1, of: Number(e['of']) })); break;
          case 'finale': io.play('win'); io.hud.announce(io.say('lb.announce.finale', { n: Number(e['passed']) })); break;
          default: break;
        }
      }
    },
  };
  return createHostedGame(spec);
}
