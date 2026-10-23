// Twist Turbine on the Game contract: the simulation (turbine.ts), its view (turbine-view.ts), the HUD, the sounds, the
// keys and swipes, and the detector the game needs.
import type { DetectorSpec, GameManifest, KeyMap, TouchMap } from '../../core/types/index.ts';
import { createHostedGame, type HostedGame, type HostSpec } from '../_shared/host.ts';
import { reasonText } from '../_shared/reasons.ts';
import { clamp } from '../_shared/util.ts';
import { TT_TIMING, TurbineSim, type TtTiming } from './turbine.ts';
import { createTurbineView } from './turbine-view.ts';
import { TT_STRINGS } from './strings.ts';

/**
 * Left and right (arrows or A and D): the key is the side the body is twisted to, held while it is down, and each press is a
 * twist to that side. Pressing the same side again is no twist (the game says "Wrong side"); in an overload the held key is
 * the held twist.
 */
export const TT_KEYS: KeyMap = {
  ArrowLeft: { channel: 'side', value: -1, event: 'twist' }, a: { channel: 'side', value: -1, event: 'twist' },
  ArrowRight: { channel: 'side', value: 1, event: 'twist' }, d: { channel: 'side', value: 1, event: 'twist' },
};
/** A swipe to a side is a twist to it and holds the side for a moment; a tap twists to the other side than the last. */
export const TT_TOUCH: TouchMap = {
  left: { channel: 'side', value: -1, holdMs: 1400, event: 'twist' },
  right: { channel: 'side', value: 1, holdMs: 1400, event: 'twist' },
  tap: { event: 'twist' },
};

/** Seated and quiet play need nothing else: the twist detector reads hands, shoulders and hips, and it makes no noise. */
export function ttDetectors(_v: { seated: boolean; silent: boolean }): DetectorSpec[] {
  return [{ id: 'twist' }];
}

/** How a recent miss stays on the reason strip, in steps (1.5 s). */
const HINT_STEPS = 90;

export interface TurbineGameOptions {
  /** A shorter run for the end-to-end tests; the game is the same. */
  timing?: Partial<TtTiming>;
}

export function createTwistTurbineGame(manifest: GameManifest, o: TurbineGameOptions = {}): HostedGame<TurbineSim> {
  const spec: HostSpec<TurbineSim> = {
    manifest,
    english: TT_STRINGS.en,
    makeSim: (setup) => new TurbineSim({ setup, met: manifest.met, timing: { ...TT_TIMING, ...o.timing } }),
    makeView: (ctx, stage, opts) => createTurbineView(ctx, stage, opts),
    detectors: ttDetectors,

    hud(sim, hud, say) {
      const seg = sim.segment;
      const storm = sim.storm;
      const p = sim.playerState;
      if (seg.kind === 'work') {
        if (storm?.kind === 'blackout') {
          hud.set('prompt', { icon: 'twist', text: say('tt.prompt.fast'), progress: Math.round(clamp(sim.stormProgress / Math.max(1, storm.need), 0, 1) * 20) / 20 });
        } else if (storm?.kind === 'overload') {
          hud.set('prompt', { icon: 'twist', text: say(storm.side < 0 ? 'tt.prompt.holdL' : 'tt.prompt.holdR'), progress: Math.round(clamp(sim.stormProgress / Math.max(1, storm.holdSteps), 0, 1) * 20) / 20 });
        } else hud.set('prompt', { icon: 'twist', text: say('tt.prompt.twist') });
      } else if (seg.kind === 'rest') hud.set('prompt', { icon: 'stand', text: say(sim.gettingReady ? 'tt.prompt.ready' : 'tt.prompt.rest') });
      else hud.set('prompt', { icon: 'twist', text: say('tt.prompt.finale') });
      hud.set('timer', Math.ceil(sim.leftS));
      hud.set('score', p.score);
      hud.set('combo', p.streak);
      hud.set('hint', p.miss && sim.k - p.miss.k < HINT_STEPS ? reasonText(say, p.miss.code) : '');
    },

    react(events, io) {
      for (const e of events) {
        switch (e.type) {
          case 'rep':
            io.play(e['inBand'] === true && Number(e['streak']) > 0 && Number(e['streak']) % 5 === 0 ? 'rep-best' : 'rep');
            break;
          case 'set':
            io.play('go');
            io.hud.announce(io.say('tt.announce.set', { n: Number(e['set']) + 1, of: Number(e['of']), lo: Number(e['lo']), hi: Number(e['hi']) }));
            break;
          case 'rest': io.play('done'); io.hud.announce(io.say('tt.announce.rest', { n: Number(e['next']) + 1, of: Number(e['of']) })); break;
          case 'finale': io.play('win'); io.hud.announce(io.say('tt.announce.finale')); break;
          case 'storm':
            io.play('warn');
            if (e['kind'] === 'blackout') io.hud.announce(io.say('tt.announce.blackout', { need: Number(e['need']), s: Math.round(Number(e['leftS'])) }));
            else io.hud.announce(io.say(Number(e['side']) < 0 ? 'tt.announce.overloadL' : 'tt.announce.overloadR', { s: Math.round(Number(e['holdS'])) }));
            break;
          case 'stormEnd':
            if (e['ok'] === true) { io.play('star'); io.hud.announce(io.say('tt.announce.stormOk', { bonus: Number(e['bonus']) })); } else { io.play('miss'); io.hud.announce(io.say('tt.announce.stormLost')); }
            break;
          default: break;
        }
      }
    },
  };
  return createHostedGame(spec);
}
