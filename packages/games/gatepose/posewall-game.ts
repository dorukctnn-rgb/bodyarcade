// Pose Wall on the Game contract: the simulation (posewall.ts), its view (posewall-view.ts), the HUD, the sounds, the keys and
// swipes, and the detector. Two players on one camera (local2) each have a lane with the same wall.
import type { DetectorSpec, GameManifest, KeyMap, TouchMap } from '../../core/types/index.ts';
import { createHostedGame, type HostedGame, type HostSpec } from '../_shared/host.ts';
import { reasonText } from '../_shared/reasons.ts';
import type { Say } from '../_shared/text.ts';
import { clamp } from '../_shared/util.ts';
import { approachU, type GpTiming } from './plan.ts';
import { PW_TIMING, PoseWallSim, TEAM_BONUS, type PwPlayer } from './posewall.ts';
import { createPoseWallView } from './posewall-view.ts';
import { PW_STRINGS } from './strings.ts';

/**
 * Without a camera the keys step through the shapes of the level: Right (or D) to the next one, Left (or A) to the one before, Down,
 * S or Space to "rest" (arms down). The avatar makes the picked shape and the wall is judged as it would be on a body.
 */
export const PW_KEYS: KeyMap = {
  ArrowRight: { channel: 'pickNext', value: 1 }, d: { channel: 'pickNext', value: 1 },
  ArrowLeft: { channel: 'pickPrev', value: 1 }, a: { channel: 'pickPrev', value: 1 },
  ArrowDown: { channel: 'pickRest', value: 1 }, s: { channel: 'pickRest', value: 1 }, ' ': { channel: 'pickRest', value: 1 },
};
/** A swipe to a side steps to the next or the previous shape; a tap or a swipe down brings the arms down. */
export const PW_TOUCH: TouchMap = {
  left: { channel: 'pickPrev', value: 1, holdMs: 120 },
  right: { channel: 'pickNext', value: 1, holdMs: 120 },
  down: { channel: 'pickRest', value: 1, holdMs: 120 },
  tap: { channel: 'pickRest', value: 1, holdMs: 120 },
};

/** Every way of playing asks for the pose matching detector: a shape is the same shape sitting or standing, and holding it makes no noise. */
export function pwDetectors(_v: { seated: boolean; silent: boolean }): DetectorSpec[] {
  return [{ id: 'poseMatch' }];
}

/** How long a reason stays on the strip, and how long the fit of a wall that was passed does, in steps (1.5 s, 1.2 s). */
const HINT_STEPS = 90;
const NOTE_STEPS = 72;

/** The part of the body a limb belongs to, for the words of "an arm was off". */
export function limbGroup(limb: string): 'armL' | 'armR' | 'legL' | 'legR' | 'torso' | 'neck' {
  if (limb === 'torso') return 'torso';
  if (limb === 'neck') return 'neck';
  const side = limb.endsWith('L') ? 'L' : 'R';
  return (limb.startsWith('arm') ? `arm${side}` : `leg${side}`) as 'armL' | 'armR' | 'legL' | 'legR';
}

/** What the strip says about a miss: the named arm or leg for a limb that was off, the shell's own sentence for the rest. */
export function missText(say: Say, miss: { code: string; limb?: string }): string {
  if (miss.code === 'limb_off' && miss.limb) return say(`pw.off.${limbGroup(miss.limb)}`);
  return reasonText(say, miss.code);
}

/** What one player's strip says now: a reason, or the fit of the wall just passed, or the team pass; the newest wins; empty when nothing is new. */
export function stripText(sim: PoseWallSim, p: Readonly<PwPlayer>, say: Say): string {
  const miss = p.miss && sim.k - p.miss.k < HINT_STEPS ? p.miss : null;
  const note = p.note && sim.k - p.note.k < NOTE_STEPS ? p.note : null;
  if (miss && (!note || miss.k >= note.k)) return missText(say, miss);
  if (note) {
    if (sim.playerCount === 2 && sim.teamAt === note.k) return say('pw.team', { bonus: TEAM_BONUS });
    return say('pw.fit', { pct: Math.round(note.fit * 100) });
  }
  return '';
}

export interface PoseWallGameOptions {
  /** A shorter run for the end-to-end tests; the game is the same. */
  timing?: Partial<GpTiming>;
}

export function createPoseWallGame(manifest: GameManifest, o: PoseWallGameOptions = {}): HostedGame<PoseWallSim> {
  const spec: HostSpec<PoseWallSim> = {
    manifest,
    english: PW_STRINGS.en,
    makeSim: (setup) => new PoseWallSim({ setup, met: manifest.met, timing: { ...PW_TIMING, ...o.timing } }),
    makeView: (ctx, stage, opts) => createPoseWallView(ctx, stage, opts),
    detectors: pwDetectors,

    hud(sim, hud, say, players) {
      const seg = sim.segment;
      if (seg.kind === 'work') {
        const next = sim.nextWall(0);
        if (!next) hud.set('prompt', { icon: 'tPose', text: say('pw.prompt.match') });
        else hud.set('prompt', { icon: 'tPose', text: say('pw.prompt.match'), progress: Math.round(clamp(approachU(sim.k, next.arriveK, sim.plan.approachK), 0, 1) * 20) / 20 });
      } else if (seg.kind === 'rest') hud.set('prompt', { icon: 'stand', text: say(sim.gettingReady ? 'pw.prompt.ready' : 'pw.prompt.rest') });
      else hud.set('prompt', { icon: 'tPose', text: say('pw.prompt.finale') });
      hud.set('timer', Math.ceil(sim.leftS));
      const ps = sim.playerStates;
      for (let i = 0; i < players; i++) {
        const p = ps[i];
        if (!p) continue;
        const text = stripText(sim, p, say);
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
          case 'wall':
            if (e['skipped'] === true) break;
            if (e['ok'] === true) io.play(e['perfect'] === true ? 'perfect' : 'pass');
            else io.play('hit');
            break;
          case 'series': io.play('star'); break;
          case 'team': io.play('coin'); break;
          case 'set': io.play('go'); io.hud.announce(io.say('pw.announce.set', { n: Number(e['set']) + 1, of: Number(e['of']) })); break;
          case 'rest': io.play('done'); io.hud.announce(io.say('pw.announce.rest', { n: Number(e['next']) + 1, of: Number(e['of']) })); break;
          case 'finale': io.play('win'); io.hud.announce(io.say('pw.announce.finale', { n: Number(e['passed']) })); break;
          default: break;
        }
      }
    },
  };
  return createHostedGame(spec);
}
