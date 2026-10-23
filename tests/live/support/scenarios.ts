// The live suite's scenarios (tech.md 2.13 A and 2.14). Each one runs a real match between headless Chromium players
// with fake cameras, against the Worker on workerd, and injects one failure. A scenario passes when the checks in
// runner.ts hold: both players got a result, the result is identical on both, every player's own score equals the
// Room's, and whatever the scenario promises (resume, forfeit, reconnect) happened.

export type Action =
  | { at: number; do: 'loss'; p: number }
  | { at: number; do: 'blackhole'; on: 0 | 1 }
  | { at: number; do: 'kick' }
  | { at: number; do: 'freeze'; p: number }
  | { at: number; do: 'reload'; p: number }
  | { at: number; do: 'reloadAll' }
  | { at: number; do: 'quit'; p: number }
  | { at: number; do: 'hide'; p: number }
  | { at: number; do: 'show'; p: number }
  | { at: number; do: 'camLoss'; p: number }
  | { at: number; do: 'dupTab'; p: number }
  | { at: number; do: 'thirdJoin' };

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
  /** Room kind for the scenario; public rooms never carry video. */
  kind?: 'private' | 'public';
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
  no_p2p: { video: true, nop2p: true },
  ws_kick: { video: true, actions: [{ at: 8000, do: 'kick' }] },
  kick_countdown: { video: true, pre: [{ at: 1200, do: 'kick' }] },
  ws_slow_b: { video: true, shape: [null, { ms: 150, jitter: 60 }] },
  ws_halfopen_b: { video: true, shape: [null, { ms: 20, jitter: 10 }], actions: [{ at: 8000, do: 'freeze', p: 1 }] },
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
};
