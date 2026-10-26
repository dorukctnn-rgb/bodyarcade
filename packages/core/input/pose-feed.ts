// PoseFeed: pose frames to the players' movement engines and the InputHub, for one player and for mode 'local2'.
//
// - One player: every frame belongs to Player 1. Mode 'local2' (players: 2): PlayerAssignment splits each frame into
//   two stable players first. The same assignment runs during calibration and play, so a profile always belongs to
//   the body that plays with it.
// - Each player's engine is connected to the hub (with its player) once it has a profile. push(f, { engines: false })
//   only splits the frame (calibration, pauses): the assignment still sees every frame and no events are produced.
// - The gate (tech.md 4.1): once a player has a profile, a player whose shoulders and hips are not seen for lostMs
//   (default 500 ms) is lost (side framing: the shoulder and hip of one side; a desk profile: the shoulders alone, as
//   Features.ok). The hub's tracking for that player turns to 'no_person' (one player) or 'player_missing'
//   (local2) and onPresence fires; it fires again when they are seen. Judged on frame time, so a trace replays the
//   same way.
import {
  LM, type BodyProfile, type DetectorSpec, type Framing, type InputHub, type Landmark, type Ms, type MovementEngine, type PlayerAssignment,
  type PlayerFrame, type PlayerSlot, type PoseFrame, type Unsubscribe,
} from '../types/index.ts';
import { createPlayerAssignment } from '../body/players.ts';
import { bodySeen, isVisible } from '../body/geometry.ts';
import { createMovementEngine } from '../moves/engine.ts';

export const FEED_DEFAULTS = { lostMs: 500 } as const;

export interface PresenceChange { player: PlayerSlot; present: boolean; t: Ms }

export interface PoseFeedOptions {
  hub: InputHub;
  /** 2 for mode 'local2'. */
  players?: 1 | 2;
  /** 'trace' when the frames come from a recorded file (ranked and live play refuse it). */
  source?: 'pose' | 'trace';
  /** One engine per player (default: the movement library). */
  engine?: (player: PlayerSlot) => MovementEngine;
  /** Mode 'local2' (default: createPlayerAssignment()). */
  assignment?: PlayerAssignment;
  lostMs?: number;
}

export interface PoseFeed {
  readonly players: 1 | 2;
  engine(p: PlayerSlot): MovementEngine;
  /** The game's detectors, for every player. */
  use(specs: DetectorSpec[]): void;
  /** Calibration results. A player's first profile connects their engine to the hub and turns their gate on. */
  setProfiles(p: Partial<Record<PlayerSlot, BodyProfile>>): void;
  /** Routes one camera frame and returns the players' frames (one, or two in local2) for the calibrator. */
  push(f: PoseFrame, o?: { engines?: boolean }): PlayerFrame[];
  /** False while a player with a profile is lost. */
  present(p: PlayerSlot): boolean;
  allPresent(): boolean;
  onPresence(cb: (e: PresenceChange) => void): Unsubscribe;
  /** New run or recalibration: engines and the gate start afresh; profiles, players and hub links stay. */
  reset(): void;
  /** Disconnects the engines from the hub. */
  dispose(): void;
}

interface Gate { armed: boolean; present: boolean; lastSeen: number | null; framing: Framing; hipsOptional: boolean }

const slotsOf = (n: 1 | 2): PlayerSlot[] => (n === 2 ? [1, 2] : [1]);

/** Shoulders found with some certainty, so a person can be placed and measured. */
const shouldersOf = (p: readonly Landmark[]): boolean => isVisible(p, LM.leftShoulder, 0.4) && isVisible(p, LM.rightShoulder, 0.4);
const shoulderX = (p: readonly Landmark[]): number => ((p[LM.leftShoulder] as Landmark).x + (p[LM.rightShoulder] as Landmark).x) / 2;
const shoulderWidth = (p: readonly Landmark[]): number => (shouldersOf(p) ? Math.abs((p[LM.leftShoulder] as Landmark).x - (p[LM.rightShoulder] as Landmark).x) : 0);

/**
 * One player with several people in the frame (the model runs for two while one player calibrates). The player is the one
 * who was the player a moment ago, the nearest to where they stood (people of the same size must not swap places from
 * frame to frame); with no one to follow (the first frame, or after a second without the player) it is the one nearest
 * the camera, the widest shoulders. A frame with one person or none is returned as it is.
 */
function createPlayerPicker(): { pick(f: PoseFrame): Landmark[] | null; reset(): void } {
  /** Where the player stood (shoulder midpoint, raw image x) and when. */
  let lastX: number | null = null;
  let lastT = -Infinity;
  const FOLLOW_MS = 1500;
  /** The player moves less than this share of the picture width between two frames of the same second. */
  const FOLLOW_DX = 0.25;
  return {
    pick(f: PoseFrame): Landmark[] | null {
      let chosen: Landmark[] | null = f.landmarks;
      const found = f.poses?.filter(shouldersOf) ?? [];
      if (found.length >= 2) {
        let best: Landmark[] | null = null;
        if (lastX !== null && f.t - lastT < FOLLOW_MS) {
          let bestDx = Infinity;
          for (const p of found) {
            const dx = Math.abs(shoulderX(p) - lastX);
            if (dx < bestDx) { bestDx = dx; best = p; }
          }
          if (bestDx > FOLLOW_DX) best = null;
        }
        if (!best) {
          best = found[0] as Landmark[];
          for (const p of found) if (shoulderWidth(p) > shoulderWidth(best)) best = p;
        }
        chosen = best;
      }
      if (chosen && shouldersOf(chosen)) { lastX = shoulderX(chosen); lastT = f.t; }
      return chosen;
    },
    reset(): void { lastX = null; lastT = -Infinity; },
  };
}

export function createPoseFeed(o: PoseFeedOptions): PoseFeed {
  const players: 1 | 2 = o.players === 2 ? 2 : 1;
  const slots = slotsOf(players);
  const lostMs = o.lostMs ?? FEED_DEFAULTS.lostMs;
  const source = o.source ?? 'pose';
  const make = o.engine ?? (() => createMovementEngine());
  const engines: Partial<Record<PlayerSlot, MovementEngine>> = {};
  for (const s of slots) engines[s] = make(s);
  const assignment = players === 2 ? (o.assignment ?? createPlayerAssignment()) : null;
  const gates: Record<PlayerSlot, Gate> = {
    1: { armed: false, present: true, lastSeen: null, framing: 'full', hipsOptional: false },
    2: { armed: false, present: true, lastSeen: null, framing: 'full', hipsOptional: false },
  };
  const links = new Map<PlayerSlot, Unsubscribe>();
  const listeners = new Set<(e: PresenceChange) => void>();
  const lostCode = players === 2 ? 'player_missing' : 'no_person';
  const picker = createPlayerPicker();

  const engineOf = (p: PlayerSlot): MovementEngine => {
    const m = engines[p];
    if (!m) throw new Error(`No player ${p} in a ${players}-player feed.`);
    return m;
  };

  const emit = (e: PresenceChange): void => {
    let first: unknown = null;
    for (const cb of [...listeners]) {
      try { cb(e); } catch (err) { first ??= err; }
    }
    if (first !== null) throw first;
  };

  function gate(p: PlayerSlot, f: PlayerFrame): PresenceChange | null {
    const g = gates[p];
    if (!g.armed) return null;
    const seen = bodySeen(f.landmarks, g.framing, g.hipsOptional);
    if (g.lastSeen === null) g.lastSeen = f.t;
    if (seen) {
      g.lastSeen = f.t;
      if (!g.present) {
        g.present = true;
        o.hub.setTracking({ ok: true }, p);
        return { player: p, present: true, t: f.t };
      }
      return null;
    }
    if (g.present && f.t - g.lastSeen >= lostMs) {
      g.present = false;
      o.hub.setTracking({ ok: false, code: lostCode }, p);
      return { player: p, present: false, t: f.t };
    }
    return null;
  }

  const feed: PoseFeed = {
    players,

    engine: engineOf,

    use(specs: DetectorSpec[]): void {
      for (const s of slots) engineOf(s).use(specs);
    },

    setProfiles(p: Partial<Record<PlayerSlot, BodyProfile>>): void {
      for (const s of slots) {
        const profile = p[s];
        if (!profile) continue;
        const m = engineOf(s);
        m.setProfile(profile);
        if (!links.has(s)) links.set(s, o.hub.connectPose(m, source, s));
        gates[s].armed = true;
        gates[s].framing = profile.framing;
        gates[s].hipsOptional = profile.hipsEstimated === true;
      }
    },

    push(f: PoseFrame, opts?: { engines?: boolean }): PlayerFrame[] {
      const frames: PlayerFrame[] = assignment ? [...assignment.push(f)] : [{ ...f, player: 1, landmarks: picker.pick(f) }];
      const changes: PresenceChange[] = [];
      for (const pf of frames) {
        if (opts?.engines !== false && gates[pf.player].armed) engineOf(pf.player).push(pf);
        const c = gate(pf.player, pf);
        if (c) changes.push(c);
      }
      for (const c of changes) emit(c);
      return frames;
    },

    present(p: PlayerSlot): boolean {
      return gates[p].present;
    },

    allPresent(): boolean {
      return slots.every((s) => gates[s].present);
    },

    onPresence(cb: (e: PresenceChange) => void): Unsubscribe {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },

    reset(): void {
      picker.reset();
      for (const s of slots) {
        engineOf(s).reset();
        const g = gates[s];
        if (!g.present) o.hub.setTracking({ ok: true }, s);
        g.present = true;
        g.lastSeen = null;
      }
    },

    dispose(): void {
      for (const off of links.values()) off();
      links.clear();
      listeners.clear();
    },
  };
  return feed;
}
