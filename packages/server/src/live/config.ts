// Live play: the Room's timings and limits in one place (tech.md 2.7, 2.8, 9.2). Tests build an engine with shorter
// values; production uses DEFAULT_TIMING. Every duration is in milliseconds.

export interface Timing {
  /** From "everyone is ready" to match time zero. */
  startCountdownMs: number;
  /** The 3-2-1 after a pause. It counts as paused time, so match time never jumps. */
  resumeCountdownMs: number;
  /** A socket gone for less than this never pauses the match (a blip, a deploy, a Wi-Fi hand-over). */
  offlineDebounceMs: number;
  /** How long one player may hold the match paused before that seat forfeits. */
  graceMs: number;
  /** After the match end: wait this long for late final lists, then score what the Room has. */
  settleMs: number;
  /** A lobby member who stays offline this long loses the seat. */
  lobbyDropMs: number;
  /** A full lobby gives an offline member's seat to a newcomer after this. */
  lobbyEvictMs: number;
  /** Obstacle results are written to storage at most this late (they are acknowledged at once; the final list heals a crash). */
  eventFlushMs: number;
  /** A room nobody is in disappears after this. */
  emptyTtlMs: number;
  /** A room with no activity at all disappears after this (tech.md 2.10: 24 h). */
  roomTtlMs: number;
  /** A forfeit or an abandoned match before this share of its length is "no contest". */
  noContestShare: number;
  /**
   * A socket that has sent nothing for this long (no message, no keep-alive ping) is dead. A phone that locks or loses its
   * network usually never sends a FIN, so the platform keeps the socket open and the seat would look online for ever.
   * The match limit applies to a socket whose player is in the running match, the lobby limit to every other socket.
   * Infinity: never (the unit tests, which have no keep-alives).
   */
  silentLobbyMs: number;
  silentMatchMs: number;
  /** How often the Room looks for silent sockets while any socket is open (the alarm wakes it). */
  sweepLobbyMs: number;
  sweepMatchMs: number;
}

export const DEFAULT_TIMING: Readonly<Timing> = {
  startCountdownMs: 3500,
  resumeCountdownMs: 3000,
  offlineDebounceMs: 5000,
  graceMs: 45_000,
  settleMs: 8000,
  lobbyDropMs: 60_000,
  lobbyEvictMs: 15_000,
  eventFlushMs: 8000,
  emptyTtlMs: 10 * 60_000,
  roomTtlMs: 24 * 3600_000,
  noContestShare: 0.3,
  // The client pings every 2 s in a match and every 5 s in a lobby: nine seconds is four missed pings in a match, forty
  // seconds eight in a lobby (a browser tab in the background may stretch its timers to a second or two).
  silentLobbyMs: 40_000,
  silentMatchMs: 9000,
  sweepLobbyMs: 15_000,
  sweepMatchMs: 3000,
};

/** Per-seat pause budget in one match: the third manual pause and the ninth pause of any kind are not held. */
export const MAX_USER_PAUSES = 2;
export const MAX_PAUSES = 8;

/** Obstacle results for obstacles further ahead than this are refused (the outcome cannot be known yet). */
export const EARLY_MS = 3000;
/** The final list is accepted this long before the nominal end (clock error and the last frame). */
export const FINAL_EARLY_MS = 1500;

/**
 * Socket rate caps (messages per second, sustained): the Room drops what exceeds a cap and closes the socket with 4008
 * when abused. Each cap is a token bucket that holds `burstSeconds` of messages, because a stalled network (a phone
 * changing cells, a busy main thread) delivers a second or two of messages at once and that is not abuse.
 */
export const RATE = {
  /** Everything but relay and signal. */
  generalPerSec: 40,
  relayPerSec: 25,
  signalPerSec: 80,
  burstSeconds: 2,
  /** Hard ceiling over one second; above it the socket is dropped. */
  hardPerSec: 300,
  /** Malformed messages tolerated per socket before it is dropped. */
  badMax: 30,
} as const;

export const MAX_REPORTS_PER_ROOM = 100;
/** Distinct reporters that mute a player's free text in this room (and for 24 h through the hook). */
export const REPORTS_TO_MUTE = 3;
export const MUTE_MS = 24 * 3600_000;
export const CHAT_LOG_LINES = 50;
export const PRESET_MIN_GAP_MS = 400;
/** Tabs remembered as "replaced" per member. */
export const MAX_REPLACED_TABS = 8;
