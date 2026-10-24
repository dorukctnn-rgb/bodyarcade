// The live suite's scenarios (tech.md 2.13 A and 2.14). Each one runs a real match between headless Chromium players
// with fake cameras, against the Worker on workerd, and injects one failure. A scenario passes when the checks in
// runner.ts hold: both players got a result, the result is identical on both, every player's own score equals the
// Room's, and whatever the scenario promises (resume, forfeit, reconnect) happened.

export type Action =
  | { at: number; do: 'loss'; p: number }
  | { at: number; do: 'blackhole'; on: 0 | 1 }
  | { at: number; do: 'kick' }
  | { at: number; do: 'freeze'; p: number }
  | { at: number; do: 'outage'; p: number; on: boolean }
  | { at: number; do: 'reload'; p: number }
  | { at: number; do: 'reloadAll' }
  | { at: number; do: 'quit'; p: number }
  | { at: number; do: 'leave'; p: number }
  | { at: number; do: 'hide'; p: number }
  | { at: number; do: 'show'; p: number }
  | { at: number; do: 'camLoss'; p: number }
  | { at: number; do: 'dupTab'; p: number }
  | { at: number; do: 'deploy' }
  | { at: number; do: 'thirdJoin' }
  /** The network now allows a direct link (every page): the next attempt can connect. */
  | { at: number; do: 'p2p' }
  /** The player presses the "try again" button of the camera note (it must be on the screen). */
  | { at: number; do: 'retry'; p: number };

export interface Shape { ms: number; jitter: number }

export interface Scenario {
  /** Players in the room (2 to 4). */
  players?: number;
  /** Camera and video for every player, or per player. */
  video?: boolean;
  videoOf?: boolean[];
  relay?: boolean;
  nop2p?: boolean;
  /** Match length in seconds (15 to 180). */
  dur?: number;
  /** Matches to play in a row (rematch after each). */
  matches?: number;
  /** Server link shaping for player 0 and player 1. */
  shape?: (Shape | null)[];
  /** CPU throttle factor and main-thread busy ms every 33 ms, per player (like pose inference on a phone). */
  cpu?: number[];
  busy?: number[];
  /** Run before match time zero, ms after the `start` message. */
  pre?: Action[];
  /** Run after match time zero, ms after it. */
  actions?: Action[];
  expect?: 'forfeit';
  /** Players press ready this long after the welcome (a lobby that idles long enough for the Room to hibernate). */
  readyDelayMs?: number;
  /** Room kind for the scenario; public rooms never carry video. */
  kind?: 'private' | 'public';
  /** The Worker answers /api/ice as one with no TURN key does (STUN only), as the product does until a key is put on it. */
  noTurn?: boolean;
  /** The language of the tiles' words (the note for a camera that did not connect). */
  lang?: 'en' | 'tr';
  /**
   * The engine each player runs in (default Chromium). The WebKit of Playwright on Windows has no RTCPeerConnection at all: that page
   * must still join, race and finish through the Room relay, with the friend drawn as a skeleton. Skipped where the engine is not installed.
   */
  engines?: ('chromium' | 'webkit' | 'firefox')[];
  /**
   * What the friend camera must do: 'failed' (told within the deadline, skeleton on the tile, one line, a retry button, never a
   * picture), 'live' (comes up and stays, nothing said) or 'recovers' (fails, then the retry makes it come up and the note goes).
   */
  expectVideo?: 'failed' | 'live' | 'recovers';
  note?: string;
}

export const SCENARIOS: Record<string, Scenario> = {
  p2p_video: { video: true },
  p2p_data_only: { video: false },
  asym_video: { videoOf: [true, false] },
  turn_only: { video: true, relay: true },
  turn_loss10: { video: true, relay: true, actions: [{ at: 5000, do: 'loss', p: 0.1 }, { at: 18_000, do: 'loss', p: 0 }] },
  turn_blackhole6s: { video: true, relay: true, actions: [{ at: 7000, do: 'blackhole', on: 1 }, { at: 13_000, do: 'blackhole', on: 0 }] },
  turn_blackhole20s: { video: true, relay: true, dur: 40, actions: [{ at: 6000, do: 'blackhole', on: 1 }, { at: 26_000, do: 'blackhole', on: 0 }] },
  no_webrtc_b: { video: false, engines: ['chromium', 'webkit'], note: 'peersBroken' },
  no_p2p: { video: true, nop2p: true, lang: 'tr', expectVideo: 'failed' },
  // the product until a TURN key exists: /api/ice offers STUN only, and two browsers on one machine still find each other
  no_turn: { video: true, noTurn: true, expectVideo: 'live' },
  // no path at all (strict networks): told in the deadline, then the network allows it, the player presses "try again", the camera comes up
  video_retry: { video: true, nop2p: true, dur: 45, expectVideo: 'recovers', actions: [{ at: 14_000, do: 'p2p' }, { at: 15_000, do: 'retry', p: 0 }] },
  ws_kick: { video: true, actions: [{ at: 8000, do: 'kick' }] },
  kick_countdown: { video: true, pre: [{ at: 1200, do: 'kick' }] },
  ws_slow_b: { video: true, shape: [null, { ms: 150, jitter: 60 }] },
  ws_halfopen_b: { video: true, shape: [null, { ms: 20, jitter: 10 }], actions: [{ at: 8000, do: 'freeze', p: 1 }] },
  // B's phone loses the network for 22 s: its connection freezes and every new attempt hangs. The Room drops the silent
  // socket and pauses for B, B's page keeps trying, and when the network is back both finish with the same result.
  ws_outage_b: { video: true, dur: 40, shape: [null, { ms: 20, jitter: 10 }], actions: [{ at: 8000, do: 'freeze', p: 1 }, { at: 8000, do: 'outage', p: 1, on: true }, { at: 30_000, do: 'outage', p: 1, on: false }], note: 'paused' },
  // B's phone locks and its page dies without a single close frame reaching the Room: the seat must not stay a ghost, it forfeits.
  ghost_b: { video: false, dur: 40, shape: [null, { ms: 20, jitter: 10 }], actions: [{ at: 8000, do: 'freeze', p: 1 }, { at: 8000, do: 'outage', p: 1, on: true }, { at: 12_000, do: 'quit', p: 1 }], expect: 'forfeit' },
  ws_freeze_end_b: { video: true, shape: [null, { ms: 20, jitter: 10 }], actions: [{ at: 22_500, do: 'freeze', p: 1 }] },
  phone_b: { video: true, shape: [null, { ms: 45, jitter: 35 }], cpu: [1, 4], busy: [0, 20] },
  phones: { video: true, shape: [{ ms: 45, jitter: 35 }, { ms: 60, jitter: 50 }], cpu: [4, 4], busy: [20, 20] },
  reload_b: { video: true, actions: [{ at: 8000, do: 'reload', p: 1 }] },
  both_reload: { video: true, actions: [{ at: 8000, do: 'reloadAll' }] },
  hide_b: { video: true, actions: [{ at: 8000, do: 'hide', p: 1 }, { at: 12_000, do: 'show', p: 1 }] },
  cam_loss_b: { video: true, actions: [{ at: 8000, do: 'camLoss', p: 1 }] },
  dup_tab_b: { video: true, actions: [{ at: 8000, do: 'dupTab', p: 1 }] },
  quit_b: { video: true, actions: [{ at: 8000, do: 'quit', p: 1 }], expect: 'forfeit' },
  rematch: { video: true, dur: 18, matches: 2 },
  soak6: { video: true, dur: 15, matches: 6 },
  room_full: { video: false, actions: [{ at: 5000, do: 'thirdJoin' }] },
  // rooms of 3 and 4 (a mesh of peer links), a public room (no video ever) and a seat that leaves
  group3: { players: 3, video: false },
  group4: { players: 4, video: false },
  group3_video: { players: 3, video: true },
  group4_leave: { players: 4, video: false, dur: 30, actions: [{ at: 9000, do: 'leave', p: 3 }] },
  group3_reload: { players: 3, video: true, actions: [{ at: 8000, do: 'reload', p: 2 }] },
  group4_quit: { players: 4, video: false, dur: 30, actions: [{ at: 8000, do: 'quit', p: 3 }] },
  public3: { players: 3, kind: 'public', video: true },
  // the Room object is evicted from memory and rebuilt from storage
  idle_lobby: { video: false, readyDelayMs: 35_000 },
  // two friends wait in a lobby for over a minute: the Room sleeps and wakes, nobody sends anything but keep-alive pings,
  // and the silence limit (40 s) must not mistake that for a vanished phone
  idle_lobby_long: { video: false, readyDelayMs: 75_000, note: 'sockets that only ping stay seated' },
  hide_long_b: { video: true, dur: 30, actions: [{ at: 8000, do: 'hide', p: 1 }, { at: 36_000, do: 'show', p: 1 }] },
  // more ways an evening goes wrong: two reloads at once in a room of four, a hidden tab during the 3-2-1, both players
  // hiding and coming back one after the other, a hidden tab that reloads before it comes back, three server restarts of the sockets in a row
  group4_double_reload: { players: 4, video: false, dur: 30, actions: [{ at: 8000, do: 'reload', p: 1 }, { at: 8000, do: 'reload', p: 2 }] },
  hide_countdown_b: { video: true, pre: [{ at: 800, do: 'hide', p: 1 }, { at: 2600, do: 'show', p: 1 }] },
  both_hide: { video: true, dur: 30, actions: [{ at: 8000, do: 'hide', p: 0 }, { at: 8600, do: 'hide', p: 1 }, { at: 11_000, do: 'show', p: 0 }, { at: 12_500, do: 'show', p: 1 }] },
  hide_reload_b: { video: true, dur: 30, actions: [{ at: 7000, do: 'hide', p: 1 }, { at: 10_000, do: 'reload', p: 1 }] },
  ws_kick3: { video: true, dur: 30, actions: [{ at: 6000, do: 'kick' }, { at: 8000, do: 'kick' }, { at: 10_000, do: 'kick' }] },
  deploy_mid_match: { video: true, actions: [{ at: 8000, do: 'deploy' }] },
  deploy_countdown: { video: true, pre: [{ at: 1200, do: 'deploy' }] },
};
