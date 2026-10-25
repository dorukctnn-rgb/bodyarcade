// A race in a room as the stage's other side (builder N): the room's LiveClient behind the RaceSource the stage already plays a
// recording through (race.ts), so the round of a room is the round of the game, wrapped by duel.ts, timed and judged by the Room.
//
//   const src = liveSource(rooms.client(), { name, book });
//   new PlayController({ ..., race: src });               // the session factory wraps the game: duelModule(inner, src.feed)
//
// What it adds to the feed of live-feed.ts:
//   - the side the Session's bridge talks to (ready when calibration ends, the Session's holds as the Room's), and the ready flag
//     given back when the stage is left before a race began (a player who walked away from the stage is not ready);
//   - the player's frame for the others about 15 times a second while a race is on: the match time, the points so far (the Room's
//     sum of what this page reported) and the skeleton (pose-frame.ts); a practice body in development builds, so the friends'
//     tiles can be tried without a camera;
//   - the others: their points and skeletons (RivalBoard, which lets a skeleton go when its frames stop), their camera when it flows;
//   - what the stage says while the race is not running: who the start waits for, the Room's own 3-2-1, who holds the race and why;
//   - the end: the Room's result for every player (places, forfeits, each run of a private room), the player's own run offered to
//     their book of recordings, and settle() for a game that is over before the Room has spoken.
import type { LiveClient } from '../../../core/net/client.ts';
import { friendTiles, type FriendTile } from '../../../core/net/friend-tile.ts';
import type { GhostBook } from '../../../core/net/ghost-book.ts';
import { runFromResult, TrackRecorder, type GhostRun } from '../../../core/net/ghost.ts';
import { ghostFrame, packPose, RivalBoard } from '../../../core/net/pose-frame.ts';
import { makeSchedule, scoreOf, specFor, type Obstacle } from '../../../core/net/schedule.ts';
import { sideOfClient, type RaceSide } from '../../../core/net/session-bridge.ts';
import type { Landmark, Unsubscribe } from '../../../core/types/index.ts';
import type { MatchInfo, MatchResult, NetPauseReason, ObstacleResult, Outcome, PresetId, ReactionId, SeatId } from '../../../core/types/net.ts';
import type { DuelFeed } from './duel.ts';
import { liveFeed, phaseOf } from './live-feed.ts';
import type { LiveRaceDetails, LiveSeat, RaceOutcome, RaceRival, RaceSource } from './race.ts';

/** What the stage shows of the race: 'watch' is a race of this room that this player is not in (they joined after it began). */
export type StagePhase = 'wait' | 'count' | 'run' | 'hold' | 'over' | 'watch';

/** The stage's phase from the client's numbers. `played`: the match this stage raced in (its result is this stage's 'over'). */
export function stagePhase(c: Pick<LiveClient, 'match' | 'playing' | 'you'>, serverNow: number, played: string | null): StagePhase {
  const m = c.match;
  if (!m) return 'wait';
  if (m.phase === 'over') return m.id === played ? 'over' : 'wait';
  if (!c.playing) return c.you && m.forfeited.includes(c.you) ? 'over' : 'watch';
  return phaseOf(m, serverNow);
}

/** Whole seconds left of the Room's 3-2-1 (the start, or the one after a pause), 0 when none is running. */
export function countOf(m: Pick<MatchInfo, 'phase' | 'startAt' | 'pauseTotal' | 'resumeAt'> | null, serverNow: number): number {
  if (!m || m.phase !== 'running') return 0;
  const zero = m.startAt + m.pauseTotal;
  const left = serverNow < zero ? zero - serverNow : m.resumeAt !== null && serverNow < m.resumeAt ? m.resumeAt - serverNow : 0;
  // the Room's start count is a little longer than three seconds (its time to reach every page): the screen says 3, 2, 1
  return left > 0 ? Math.min(3, Math.ceil(left / 1000)) : 0;
}

/** One friend on the stage: the tile's model (friend-tile.ts) with the points, the skeleton and the camera picture when it flows. */
export interface LiveTile extends FriendTile {
  score: number;
  pose: Landmark[] | null;
  stream: MediaStream | null;
  /** Left the race (forfeited) or the room. */
  out: boolean;
}

export interface LiveView {
  phase: StagePhase;
  /** The Room's 3-2-1 in whole seconds (count). */
  count: number;
  /** The names of the others the start waits for (not ready, or not online). */
  waiting: string[];
  /** Nobody else is in the room. */
  alone: boolean;
  /** The others who hold the race, and why. */
  held: { name: string; reason: NetPauseReason }[];
  /** This page's connection to the Room. */
  online: boolean;
  match: string | null;
  seed: number | null;
  tiles: LiveTile[];
}

/** A message of the room, for a bubble over the tile of who sent it. */
export interface LiveMessage { seat: SeatId; name: string; preset?: PresetId; react?: ReactionId; text?: string }

export interface LiveSource extends RaceSource {
  readonly kind: 'live';
  readonly feed: DuelFeed;
  readonly side: RaceSide;
  /** The code of the room. */
  readonly room: string;
  view(): LiveView;
  onMessage(cb: (m: LiveMessage) => void): Unsubscribe;
  react(id: ReactionId): void;
  retryVideo(seat: SeatId): void;
  settle(): Promise<RaceOutcome | null>;
}

export interface LiveSourceOptions {
  /** The code of the room. */
  room: string;
  /** The player's name (their own run carries it). */
  name: string;
  /** The player's book of recordings: their own run is offered to it, so the best one stays for a race against it later. */
  book?: GhostBook | null;
  /** The page's clock in ms (performance.now): the skeletons go when their frames stop. */
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
  /** No body is filmed (the practice session of development and test builds): the friends see a stand-in figure that moves. */
  standIn?: boolean;
  /** How long settle() waits for the Room's result (default 20 s: the Room's grace for the last final list is shorter). */
  settleMs?: number;
}

/** The frame rate of the state the others get (about 15 a second, like the facade's ghost). */
export const FRAME_MS = 66;
/** A pose frame older than this is not the body of now: the frame goes without one (or with the stand-in). */
const POSE_FRESH_MS = 400;

/** A figure that moves, for a body that is not filmed: 33 landmarks of the camera picture. */
export function standInBody(ms: number): Landmark[] {
  const sway = Math.sin(ms / 420) * 0.04;
  const dip = (Math.sin(ms / 300) + 1) * 0.05;
  const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  const put = (i: number, x: number, y: number): void => { lm[i] = { x: x + sway, y: y + dip * (y > 0.5 ? 0.5 : 1), z: 0, visibility: 1 }; };
  put(0, 0.5, 0.16);
  put(11, 0.42, 0.3); put(12, 0.58, 0.3);
  put(13, 0.36, 0.42); put(14, 0.64, 0.42);
  put(15, 0.34, 0.54 - dip); put(16, 0.66, 0.54 - dip);
  put(23, 0.45, 0.58); put(24, 0.55, 0.58);
  put(25, 0.44, 0.74); put(26, 0.56, 0.74);
  put(27, 0.44, 0.9); put(28, 0.56, 0.9);
  return lm;
}

/** Every player of a result, best first and the ones who left last, with each run of a private room. Pure. */
export function liveSeats(o: {
  result: MatchResult; match: Pick<MatchInfo, 'id' | 'gameId' | 'seed' | 'duration' | 'seats'>; you: SeatId | null; names: ReadonlyMap<SeatId, string>;
  ownName: string; track?: string | undefined; at?: number;
}): LiveSeat[] {
  const r = o.result;
  const seats = [...new Set([...o.match.seats, ...Object.keys(r.scores)])];
  const list = seats.map((seat): LiveSeat => {
    const mine = seat === o.you;
    const name = mine ? o.ownName : (o.names.get(seat) ?? '');
    const s = r.scores[seat];
    return {
      seat, name, score: s?.score ?? 0, passes: s?.passes ?? 0, hits: s?.hits ?? 0, place: r.places[seat] ?? null, forfeited: r.forfeited.includes(seat), you: mine,
      run: runFromResult({ result: r, match: o.match, seat, mine, name, ...(mine && o.track ? { track: o.track } : {}), ...(o.at !== undefined ? { at: o.at } : {}) }),
    };
  });
  const rank = (x: LiveSeat): number => (x.forfeited || x.place === null ? 1000 : x.place);
  return list.sort((a, b) => rank(a) - rank(b) || b.score - a.score || (a.seat < b.seat ? -1 : a.seat > b.seat ? 1 : 0));
}

/** The result of a race in a room as the results screen reads a race (race.ts RaceOutcome), with every player. Pure. */
export function liveOutcome(result: MatchResult, seats: readonly LiveSeat[], room: string, best: RaceOutcome['best']): RaceOutcome {
  const me = seats.find((s) => s.you);
  const others = seats.filter((s) => !s.you);
  const top = others.filter((s) => !s.forfeited).reduce<LiveSeat | null>((b, s) => (!b || s.score > b.score ? s : b), null);
  const you = me?.score ?? 0;
  const won = !!me && result.winner === me.seat;
  const draw = result.winner === null && result.reason === 'complete' && !!me && !me.forfeited;
  // a race that ended too early to count (no_contest), or that nobody finished (abandoned), is lost by nobody
  const counted = result.reason === 'complete' || result.reason === 'forfeit';
  const live: LiveRaceDetails = { reason: result.reason, seats: [...seats], room };
  return {
    kind: 'live', you, won, draw, lost: counted && !won && !draw,
    rivals: others.map((s) => ({ name: s.name, score: s.score, label: null })),
    margin: you - (top?.score ?? 0), best, code: null, live,
  };
}

/**
 * The race of the room the client is in, for the stage. Nothing here leaves the room or stops the client: the room is the app's
 * (live-room.ts), and the stage only plays a race in it.
 */
export function liveSource(c: LiveClient, o: LiveSourceOptions): LiveSource {
  const now = o.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const every = o.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const stopEvery = o.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  const later = o.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const stopLater = o.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const room = o.room;
  const inner = liveFeed(c);
  const board = new RivalBoard(now);
  const names = new Map<SeatId, string>();
  const streams = new Map<SeatId, MediaStream>();
  const msgCbs = new Set<(m: LiveMessage) => void>();
  const settleCbs = new Set<() => void>();
  let off = false;
  let online = true;
  let readySent = false;
  /** The match this stage raced in. */
  let played: string | null = null;
  /** What this page reported in the match it races, and its course. */
  let mine = new Map<number, Outcome>();
  let course: { id: string; list: Obstacle[] } | null = null;
  let recorder: TrackRecorder | null = null;
  let pose: { lm: Landmark[]; at: number } | null = null;
  let result: MatchResult | null = null;
  let outcomeCache: RaceOutcome | null = null;

  const learnNames = (): void => { for (const m of c.members) if (m.name) names.set(m.seat, m.name); };
  learnNames();

  const courseOf = (m: MatchInfo): Obstacle[] => {
    if (course?.id !== m.id) course = { id: m.id, list: makeSchedule(m.seed, m.duration, specFor(m.gameId)) };
    return course.list;
  };
  const myResults = (): ObstacleResult[] => [...mine].map(([ob, k]) => ({ ob, k }));
  const myScore = (): number => {
    const m = c.match;
    return m && m.id === played ? scoreOf(courseOf(m), myResults()).score : 0;
  };
  /** A match this page races in now: its course and what the Room already holds of this player (a page that came back). */
  const enter = (m: MatchInfo, held: readonly ObstacleResult[]): void => {
    if (played === m.id) { for (const e of held) if (!mine.has(e.ob)) mine.set(e.ob, e.k); return; }
    played = m.id;
    mine = new Map();
    for (const e of held) if (!mine.has(e.ob)) mine.set(e.ob, e.k);
    recorder = new TrackRecorder(m.duration);
    result = null;
    outcomeCache = null;
  };

  const feed: DuelFeed = {
    match: () => inner.match(),
    time: () => inner.time(),
    phase: () => inner.phase(),
    report(ob, k) {
      const m = c.match;
      if (m && m.id === played && !mine.has(ob)) mine.set(ob, k);
      inner.report(ob, k);
    },
    finish: (results) => {
      for (const e of results) if (!mine.has(e.ob)) mine.set(e.ob, e.k);
      inner.finish(results);
    },
    // the frames to the others go out on this page's own beat (send below), with the skeleton; the game's own state adds nothing
    state: () => undefined,
  };

  const send = (): void => {
    if (off) return;
    const m = c.match;
    if (!m || m.phase === 'over' || !c.playing) return;
    if (played !== m.id) enter(m, []);
    const t = now();
    const real = pose && t - pose.at <= POSE_FRESH_MS ? pose.lm : null;
    const mt = c.matchTime();
    if (real && m.phase === 'running' && mt >= 0) recorder?.push(mt, packPose(real));
    c.sendState(ghostFrame(mt, myScore(), real ?? (o.standIn ? standInBody(t) : null)));
  };
  const beat = every(send, FRAME_MS);

  const decide = (r: MatchResult): RaceOutcome | null => {
    const m = c.match;
    if (!m || m.id !== r.mid) return null;
    learnNames();
    const seats = liveSeats({ result: r, match: m, you: c.you, names, ownName: o.name, track: recorder?.finish() });
    const own = seats.find((s) => s.you)?.run ?? null;
    let best: RaceOutcome['best'] = 'none';
    if (own && o.book && !seats.find((s) => s.you)?.forfeited) {
      try { const k = o.book.offer(own); best = k === 'invalid' ? 'none' : k; } catch { best = 'none'; }
    }
    return liveOutcome(r, seats, room, best);
  };

  const offs: Unsubscribe[] = [
    c.on('welcome', (w) => { learnNames(); if (w.match && w.match.phase !== 'over' && c.playing) enter(w.match, w.mine); }),
    c.on('presence', () => learnNames()),
    c.on('match', (d) => { learnNames(); if (c.playing) enter(d.match, d.why === 'welcome' ? d.mine : []); }),
    c.on('result', (r) => {
      // only the result of the race this stage played: a result of a race that began before this page joined it is not this player's
      if (r.mid !== played) return;
      result = r;
      outcomeCache = decide(r);
      for (const cb of [...settleCbs]) cb();
    }),
    c.on('state', (s) => { board.accept(s.from, s.d); }),
    c.on('track', (t) => { streams.set(t.from, t.stream); }),
    c.on('status', (s) => { online = s.state === 'online'; }),
    c.on('chat', (m) => { if (!off) for (const cb of [...msgCbs]) cb({ seat: m.from, name: names.get(m.from) ?? '', text: m.text }); }),
    c.on('preset', (m) => { if (!off) for (const cb of [...msgCbs]) cb({ seat: m.from, name: names.get(m.from) ?? '', preset: m.id }); }),
    c.on('react', (m) => { if (!off) for (const cb of [...msgCbs]) cb({ seat: m.from, name: names.get(m.from) ?? '', react: m.id }); }),
  ];
  // a page that joined (or came back to) a race that is running: it races in it
  if (c.match && c.match.phase !== 'over' && c.playing) enter(c.match, []);

  const clientSide = sideOfClient(c);
  const side: RaceSide = {
    ready: (on) => { if (off) return; readySent = on; clientSide.ready(on); },
    pause: (r) => { if (!off) clientSide.pause(r); },
    unpause: (r) => { if (!off) clientSide.unpause(r); },
  };

  const rivals = (): RaceRival[] => inner.rivals().map((r) => ({ seat: r.seat, name: r.name || (names.get(r.seat) ?? ''), score: board.score(r.seat) ?? r.score }));

  const view = (): LiveView => {
    const serverNow = c.serverNow();
    const phase = stagePhase(c, serverNow, played);
    const m = c.match;
    const you = c.you;
    const others = c.members.filter((x) => x.seat !== you);
    const forfeited = new Set(m?.forfeited ?? []);
    const scores = new Map(rivals().map((r) => [r.seat, r.score] as const));
    const held = m && m.phase === 'paused'
      ? Object.entries(m.reasons).filter(([seat]) => seat !== you).map(([seat, reason]) => ({ name: names.get(seat) ?? '', reason }))
      : [];
    const tiles: LiveTile[] = friendTiles(c.members, you, c.videoStatuses()).map((t) => ({
      ...t, score: scores.get(t.seat) ?? 0, pose: board.pose(t.seat), stream: t.show === 'video' ? (streams.get(t.seat) ?? null) : null, out: forfeited.has(t.seat),
    }));
    return {
      phase, count: phase === 'count' ? countOf(m, serverNow) : 0,
      waiting: others.filter((x) => !x.ready || !x.online).map((x) => x.name),
      alone: others.length === 0, held, online,
      match: m && m.id === played ? m.id : null, seed: m && m.id === played ? m.seed : null,
      tiles,
    };
  };

  const outcome = (): RaceOutcome | null => {
    if (outcomeCache) return outcomeCache;
    const r = inner.result();
    if (r && r.mid === played) { result = r; outcomeCache = decide(r); }
    return outcomeCache;
  };

  const stop = (): void => {
    if (off) return;
    // a player who leaves the stage before a race began is not ready any more (a race that ran has cleared the flags already)
    if (readySent && played === null) clientSide.ready(false);
    off = true;
    stopEvery(beat);
    for (const f of offs.splice(0)) f();
    inner.dispose();
    msgCbs.clear();
    for (const cb of [...settleCbs]) cb();
    settleCbs.clear();
    board.clear();
    streams.clear();
  };

  return {
    kind: 'live',
    feed,
    side,
    room,
    label: null,
    rivals,
    onRivals(cb) {
      // the points of the others change with every frame: the plates follow them a few times a second, and only when they changed
      let last = '';
      const h = every(() => {
        const list = rivals();
        const key = list.map((r) => `${r.seat}:${r.name}:${r.score}`).join('|');
        if (key !== last) { last = key; cb(list); }
      }, 250);
      return () => stopEvery(h);
    },
    sendPose(landmarks) {
      if (off || !landmarks) return;
      pose = { lm: [...landmarks], at: now() };
    },
    view,
    onMessage(cb) { msgCbs.add(cb); return () => { msgCbs.delete(cb); }; },
    react(id) { if (!off) c.react(id); },
    retryVideo(seat) { if (!off) c.retryVideo(seat); },
    outcome,
    settle() {
      const done = outcome();
      if (done || off) return Promise.resolve(done);
      return new Promise((resolve) => {
        let h: unknown = null;
        const finish = (): void => { settleCbs.delete(finish); if (h !== null) stopLater(h); resolve(outcome()); };
        settleCbs.add(finish);
        h = later(finish, o.settleMs ?? 20_000);
      });
    },
    leave() { stop(); },
    dispose() { stop(); },
  };
}

export type { LiveRaceDetails, LiveSeat };
