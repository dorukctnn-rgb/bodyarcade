// Firework Jacks on the Game contract: the simulation (fireworks.ts), its view (fireworks-view.ts), the HUD, the sounds,
// the keys and taps, and the detectors a way of playing needs.
import type { DetectorSpec, GameManifest, KeyMap, TouchMap } from '../../core/types/index.ts';
import { createHostedGame, type HostedGame, type HostSpec } from '../_shared/host.ts';
import { reasonText } from '../_shared/reasons.ts';
import { FireworkSim, FJ_TIMING, type FjTiming } from './fireworks.ts';
import { createFireworksView } from './fireworks-view.ts';
import { FJ_STRINGS } from './strings.ts';

/** Space, up, W, Enter or a tap: one jack. The session binds them only while counting down and playing. */
export const FJ_KEYS: KeyMap = {
  ' ': { event: 'jumpingJack' }, ArrowUp: { event: 'jumpingJack' }, w: { event: 'jumpingJack' }, Enter: { event: 'jumpingJack' },
};
export const FJ_TOUCH: TouchMap = { tap: { event: 'jumpingJack' }, up: { event: 'jumpingJack' } };

/**
 * The detector for a way of playing: seated plays arm jacks (the feet are not in view), quiet plays step jacks (one foot out
 * to the side, no hop). The session reads `manifest.detectors` after the game's init(), which is where the host writes this.
 */
export function fjDetectors(v: { seated: boolean; silent: boolean }): DetectorSpec[] {
  if (v.seated) return [{ id: 'jumpingJack', opts: { armsOnly: 1 } }];
  if (v.silent) return [{ id: 'jumpingJack', opts: { step: 1 } }];
  return [{ id: 'jumpingJack' }];
}

/** How a recent miss stays on the reason strip, in steps (1.5 s). */
const HINT_STEPS = 90;

export interface FireworkGameOptions {
  /** A shorter run for the end-to-end tests; the game is the same. */
  timing?: Partial<FjTiming>;
}

export function createFireworkJacksGame(manifest: GameManifest, o: FireworkGameOptions = {}): HostedGame<FireworkSim> {
  const spec: HostSpec<FireworkSim> = {
    manifest,
    english: FJ_STRINGS.en,
    makeSim: (setup) => new FireworkSim({ setup, met: manifest.met, timing: { ...FJ_TIMING, ...o.timing } }),
    makeView: (ctx, stage, opts) => createFireworksView(ctx, stage, opts),
    detectors: fjDetectors,

    hud(sim, hud, say, players) {
      const seg = sim.segment;
      const variant = sim.variant;
      if (seg.kind === 'work') {
        if (sim.countingIn) hud.set('prompt', { icon: 'stand', text: say('fj.prompt.ready') });
        else hud.set('prompt', { icon: variant === 'arms' ? 'seated' : 'jackOpen', text: say(variant === 'arms' ? 'fj.prompt.arm' : variant === 'step' ? 'fj.prompt.step' : 'fj.prompt.jack') });
      } else if (seg.kind === 'rest') hud.set('prompt', { icon: 'stand', text: say('fj.prompt.rest') });
      else hud.set('prompt', { icon: 'jackOpen', text: say('fj.prompt.finale') });
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
          case 'beat':
            io.play(e['count'] === true ? 'tick' : 'metronome');
            if (e['count'] === false && e['n'] === 4) io.play('go');
            break;
          case 'jack': {
            io.play('firework-launch');
            const g = e['grade'];
            io.play(g === 'perfect' ? 'perfect' : g === 'good' ? 'good' : g === 'off' ? 'late' : 'rep');
            break;
          }
          case 'double': io.play('star'); break;
          case 'set': io.hud.announce(io.say('fj.announce.set', { n: Number(e['set']) + 1, of: Number(e['of']), bpm: Number(e['bpm']) })); break;
          case 'rest': io.play('done'); io.hud.announce(io.say('fj.announce.rest', { n: Number(e['next']) + 1, of: Number(e['of']) })); break;
          case 'finale': io.play('win'); io.hud.announce(io.say('fj.announce.finale')); break;
          default: break;
        }
      }
    },
  };
  return createHostedGame(spec);
}
