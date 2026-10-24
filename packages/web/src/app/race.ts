// A race on the stage, whoever the other side is. The game plays through the duel wrapper (duel.ts), which reads a feed: the Room's
// clock for a live race (live-feed.ts), a recording's for a ghost race (core/net/ghost-race.ts). This file is what the stage needs
// beyond that, without a browser: which recording an address stands for, what a player may race (their own best, their family's
// bests, the recordings of friends, a practice partner that is a bot), how the stage tells the recording that the player is
// ready or held, and what the result says. The labels are always honest: a bot is never a person, a recording is never live.
import type { GhostBook } from '../../../core/net/ghost-book.ts';
import { BOT_LEVELS, botRun, decodeRun, encodeRun, ghostLabel, type BotLevel, type GhostLabel, type GhostRun } from '../../../core/net/ghost.ts';
import type { GhostRace, GhostRival } from '../../../core/net/ghost-race.ts';
import type { RaceSide } from '../../../core/net/session-bridge.ts';
import type { AvatarId, ProfileRules } from '../../../core/store/index.ts';
import type { Landmark, Unsubscribe } from '../../../core/types/index.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import type { DuelFeed } from './duel.ts';

/** A race lasts as long as the game's round, from half a minute to a minute and a half (a race is a sprint, not a workout): the same sum as the room's. */
export const raceMsOf = (g: Pick<ShellGame, 'durationSec'>): number => Math.max(30, Math.min(90, g.durationSec)) * 1000;

// ---- what an address asks for -----------------------------------------------------------------------------------------------

/** `?ghost=` on the page of a game or of its round. */
export type GhostSpec =
  | { kind: 'own' }
  | { kind: 'practice'; level: BotLevel }
  | { kind: 'family'; id: string }
  | { kind: 'code'; text: string };

const CODE = /^[A-Za-z0-9_-]{16,400}$/;

/** Reads the value of `?ghost=`; null for anything it does not understand. A bare code is what a friend's link carries. */
export function parseGhost(raw: string | null | undefined): GhostSpec | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  if (v === 'own') return { kind: 'own' };
  if (v === 'practice') return { kind: 'practice', level: 'medium' };
  const level = /^practice:([a-z]+)$/.exec(v)?.[1];
  if (level) return (BOT_LEVELS as readonly string[]).includes(level) ? { kind: 'practice', level: level as BotLevel } : null;
  const family = /^family:(p[1-9]\d{0,2})$/.exec(v)?.[1];
  if (family) return { kind: 'family', id: family };
  const code = /^code:([A-Za-z0-9_-]{16,400})$/.exec(v)?.[1];
  if (code) return { kind: 'code', text: code };
  return CODE.test(v) ? { kind: 'code', text: v } : null;
}

/** The value of `?ghost=` for a spec (what the buttons put in the address). */
export function ghostParam(spec: GhostSpec): string {
  switch (spec.kind) {
    case 'own': return 'own';
    case 'practice': return `practice:${spec.level}`;
    case 'family': return `family:${spec.id}`;
    case 'code': return `code:${spec.text}`;
  }
}

/** A recording as a spec: a code of its own, so any recording (a friend's from the book, a pasted one) can be raced through the address. */
export const specOfRun = (run: GhostRun): GhostSpec => ({ kind: 'code', text: encodeRun(run) });

/** The code in what a player pasted: the code itself or a link that has it as `?ghost=` (a friend sent either). */
export function codeIn(pasted: string): string | null {
  const t = pasted.trim();
  if (!t) return null;
  let value: string | null = t;
  if (/^https?:\/\//i.test(t)) {
    try { value = new URL(t).searchParams.get('ghost'); } catch { return null; }
  }
  const p = parseGhost(value);
  return p?.kind === 'code' ? p.text : null;
}

// ---- the recording ----------------------------------------------------------------------------------------------------------

export interface RaceWorld {
  game: Pick<ShellGame, 'id' | 'durationSec'>;
  /** The recordings this player keeps. */
  ghosts: GhostBook;
  /** The other players of this device, for the family's bests (a read-only look at their books). */
  family?: (id: string) => GhostBook | null;
  now(): number;
  /** A new seed for a practice partner's course. */
  seed(): number;
  /** How long a race is (default: raceMsOf the game); a test shortens it. */
  durationMs?: number;
}

/** The recording a spec stands for, or null when there is none to race: no best run yet, a code that is not a recording or is of another game. */
export function ghostRunOf(spec: GhostSpec, w: RaceWorld): GhostRun | null {
  const ms = w.durationMs ?? raceMsOf(w.game);
  switch (spec.kind) {
    case 'own': return w.ghosts.best(w.game.id, ms);
    case 'practice': return botRun({ gameId: w.game.id, seed: w.seed(), durationMs: ms, level: spec.level, at: w.now() });
    case 'family': return w.family?.(spec.id)?.best(w.game.id, ms) ?? null;
    case 'code': {
      const run = decodeRun(spec.text);
      return run && run.gameId === w.game.id ? run : null;
    }
  }
}

/** What a player may race in a game: the choices of the "Race a ghost" window, from their books and their rules. */
export interface GhostMenu {
  own: GhostRun | null;
  /** The recordings of friends the player keeps (adults and the main player only). */
  friends: GhostRun[];
  /** The best run of each other player of this device in this game. */
  family: { id: string; name: string; avatar: AvatarId; run: GhostRun }[];
  levels: readonly BotLevel[];
  /** The player may paste a code or a link a friend sent (not a child: the recording is a stranger's words). */
  code: boolean;
}

export function ghostMenu(o: { game: Pick<ShellGame, 'id' | 'durationSec'>; ghosts: GhostBook; rules: Pick<ProfileRules, 'ghosts'>; others: readonly { id: string; name: string; avatar: AvatarId; ghosts: GhostBook }[]; durationMs?: number }): GhostMenu {
  const ms = o.durationMs ?? raceMsOf(o.game);
  const all = o.rules.ghosts === 'all';
  return {
    own: o.ghosts.best(o.game.id, ms),
    friends: all ? o.ghosts.friends(o.game.id).filter((r) => r.durationMs === ms) : [],
    family: o.others.flatMap((p) => { const run = p.ghosts.best(o.game.id, ms); return run ? [{ id: p.id, name: p.name, avatar: p.avatar, run }] : []; }),
    levels: BOT_LEVELS,
    code: all,
  };
}

// ---- the recording as the stage's other side ----------------------------------------------------------------------------------

/**
 * What the Session's bridge tells the other side. A recording has no Room to tell: it begins its 3-2-1 when the player is ready,
 * stands still while anything holds the player (camera lost, framing, a hidden tab, the pause button) and goes on with the next
 * 3-2-1 when the last hold is gone. Holds are counted by reason, because the bridge moves from one reason to the next.
 */
export function sideOfGhost(ghost: Pick<GhostRace, 'start' | 'hold'>): RaceSide {
  const holds = new Set<string>();
  return {
    ready: (on) => { if (on) ghost.start(); },
    pause: (reason) => { holds.add(reason); ghost.hold(true); },
    unpause: (reason) => { holds.delete(reason); if (holds.size === 0) ghost.hold(false); },
  };
}

/** One rival on the plates: who, and how many points they have now. */
export interface RaceRival { seat: string; name: string; score: number }

/** What the stage reads from a race, whoever the other side is. */
export interface RaceSource {
  readonly kind: 'ghost' | 'live';
  /** What the game's wrapper plays by. */
  readonly feed: DuelFeed;
  readonly side: RaceSide;
  /** The others, as the plates show them. */
  rivals(): RaceRival[];
  onRivals(cb: (r: RaceRival[]) => void): Unsubscribe;
  /** The player's own body, with every pose frame (a recording keeps it for the skeleton of the next race; nobody else gets it). */
  sendPose?(landmarks: readonly Landmark[] | null): void;
  /** What the recording is, in words the screens say (null for a live race, where the names are the friends'). */
  readonly label: GhostLabel | null;
  /** How the race ended, once it has. */
  outcome(): RaceOutcome | null;
  /** The player leaves the race: nothing more is called. */
  leave(): void;
  dispose(): void;
}

/** How a race ended, for the results screen. */
export interface RaceOutcome {
  kind: 'ghost' | 'live';
  /** The player's points. */
  you: number;
  /** The others and their points, best first (a ghost race has one). */
  rivals: { name: string; score: number; label: GhostLabel | null }[];
  won: boolean;
  lost: boolean;
  draw: boolean;
  /** The player's points minus the best rival's. */
  margin: number;
  /** A ghost race: 'best' when the run became the player's best, 'kept' when the old best stays, 'none' when nothing was kept (a family member's profile, no book). */
  best: 'best' | 'kept' | 'none';
  /** The player's run as a code to send, or null when sending is not allowed (a child's screens, a run that was not kept as a recording). */
  code: string | null;
  /** Where the next race of the same kind goes (the address of the round), for "Race again". */
  again?: string;
}

export interface GhostSourceOptions {
  /** The player may send their run (the profile's rule). */
  share: boolean;
  /** Said to the page when a race is over (the result may be shown). */
  onOver?: () => void;
}

/** A ghost race as the stage's other side. */
export function ghostSource(ghost: GhostRace, o: GhostSourceOptions): RaceSource {
  let off = false;
  const label = ghost.label;
  const rivals = (): RaceRival[] => ghost.rivals().map((r: GhostRival) => ({ seat: r.seat, name: r.name, score: r.score }));
  return {
    kind: 'ghost',
    feed: ghost,
    side: sideOfGhost(ghost),
    rivals,
    onRivals: (cb) => ghost.onRivals((list) => cb(list.map((r) => ({ seat: r.seat, name: r.name, score: r.score })))),
    sendPose: (l) => { if (!off) ghost.sendPose(l); },
    label,
    outcome() {
      const g = ghost.outcome();
      if (!g) return null;
      return {
        kind: 'ghost', you: g.you.score, rivals: [{ name: label.name, score: g.ghost.score, label }], won: g.won, lost: g.lost, draw: g.draw, margin: g.margin,
        best: g.best === 'invalid' ? 'none' : g.best,
        code: o.share ? encodeRun(g.run) : null,
      };
    },
    leave() { off = true; ghost.dispose(); },
    dispose() { off = true; ghost.dispose(); },
  };
}

/** The label of a recording for a plate: short enough for the corner of a phone. */
export function plateName(label: GhostLabel, t: { t(key: string, vars?: Record<string, string | number>): string }): string {
  switch (label.key) {
    case 'ghost.label.own': return t.t('race.plate.own');
    case 'ghost.label.bot': return t.t('race.plate.bot');
    case 'ghost.label.friend': return label.name;
    default: return t.t('race.plate.recording');
  }
}

/** The label of a recording for a sentence: "Your best run", "Recording of Ada", "Practice partner (a bot)". */
export const labelOf = (run: Pick<GhostRun, 'source' | 'name' | 'at'>): GhostLabel => ghostLabel(run);

/** The points of a recording, for the menu ("41 points, 3 Oct"). */
export { runScore } from '../../../core/net/ghost.ts';
