// The players of the simulation bot: ways of being at the controls that need no knowledge of a game. They feed the real
// Session through the same input hub a camera or a keyboard feeds, one frame at a time.
//   idle       does nothing at all (the person stands there)
//   chaos      random movement events and channel values from the game's own detectors, in bursts, for every player
//   mash       presses keys of the game's key map at random, with key-ups, as a child on a keyboard would
//   blackout   plays like chaos but loses the person for stretches ("no person", "Player 2 missing")
//   pauser     idle, but pauses and resumes at random times and sends the page to the background
import type { InputEvent, InputHub, KeyMap, MovementId, PlayerSlot, Session } from '../../packages/core/types/index.ts';

export type Rnd = () => number;

export interface ProfileEnv {
  hub: InputHub;
  session: Session;
  /** Where the session listens for keys. */
  keys: EventTarget;
  /** The `visibilitychange` target of the session. */
  doc: EventTarget & { hidden: boolean };
  ids: readonly MovementId[];
  keyMap: KeyMap | undefined;
  players: readonly PlayerSlot[];
  rnd: Rnd;
}

export interface Profile {
  id: string;
  /** Called once per frame (60 per second) while the round runs. */
  act(frame: number, env: ProfileEnv): void;
}

const KINDS = ['rep', 'hit', 'holdStart', 'holdEnd', 'value'] as const;

function randomEvent(env: ProfileEnv, t: number): InputEvent {
  const id = env.ids[Math.floor(env.rnd() * env.ids.length)] ?? 'squat';
  const kind = KINDS[Math.floor(env.rnd() * KINDS.length)] ?? 'rep';
  const e: InputEvent = { id, kind, t, source: 'test' };
  if (env.rnd() < 0.5) e.side = env.rnd() < 0.5 ? 'L' : 'R';
  if (kind === 'value' || env.rnd() < 0.3) e.value = env.rnd() * 2 - 0.5;
  if (env.rnd() < 0.5) e.q = { depth: env.rnd(), speed: env.rnd() * 2, range: env.rnd() };
  return e;
}

const NAMES = ['crouch', 'lean', 'lane', 'drop', 'glide', 'armed', 'twist', 'hand.L.x', 'hand.L.y', 'hand.R.x', 'hand.R.y', 'energy', 'steady', 'pose', 'arm.L', 'arm.R', 'cursor.x', 'cursor.y'];

function chaos(frame: number, env: ProfileEnv): void {
  // Bursts: a quiet second, then a busy one.
  const busy = Math.floor(frame / 60) % 2 === 1;
  for (const player of env.players) {
    const channels: Record<string, number> = {};
    if (frame % 3 === 0) for (let i = 0; i < 3; i++) channels[NAMES[Math.floor(env.rnd() * NAMES.length)] as string] = env.rnd() * 2 - 1;
    const events: InputEvent[] = [];
    if (busy && env.rnd() < 0.35) events.push(randomEvent(env, frame * (1000 / 60)));
    if (Object.keys(channels).length || events.length) env.hub.inject('test', { channels, events }, env.players.length > 1 ? player : undefined);
  }
}

function press(env: ProfileEnv, key: string, up: boolean): void {
  const ev = Object.assign(new Event(up ? 'keyup' : 'keydown'), { key, repeat: false, metaKey: false, ctrlKey: false, altKey: false, code: key });
  env.keys.dispatchEvent(ev);
}

const held = new WeakMap<ProfileEnv, string[]>();

export const PROFILES: Record<string, Profile> = {
  idle: { id: 'idle', act() {} },

  chaos: { id: 'chaos', act: chaos },

  mash: {
    id: 'mash',
    act(frame, env) {
      const keys = Object.keys(env.keyMap ?? {});
      if (!keys.length) { chaos(frame, env); return; }
      const down = held.get(env) ?? [];
      held.set(env, down);
      if (env.rnd() < 0.12) { const k = keys[Math.floor(env.rnd() * keys.length)] as string; press(env, k, false); down.push(k); }
      if (down.length && env.rnd() < 0.1) press(env, down.splice(Math.floor(env.rnd() * down.length), 1)[0] as string, true);
    },
  },

  blackout: {
    id: 'blackout',
    act(frame, env) {
      chaos(frame, env);
      // Every few seconds somebody leaves the picture for a while.
      const phase = Math.floor(frame / 90) % 4;
      for (const player of env.players) {
        const gone = phase === 1 || (phase === 3 && player === 2);
        env.hub.setTracking(gone ? { ok: false, code: env.players.length > 1 ? 'player_missing' : 'no_person' } : { ok: true }, env.players.length > 1 ? player : undefined);
      }
    },
  },

  pauser: {
    id: 'pauser',
    act(frame, env) {
      // A pause of a second every 20 s of play, and the page in the background for a second every 32 s (each pause costs a countdown).
      if (frame % 1200 === 400 && env.session.state === 'running') env.session.pause('user');
      else if (frame % 1200 === 460 && env.session.state === 'paused') void env.session.resume();
      else if (frame % 1900 === 900) { env.doc.hidden = true; env.doc.dispatchEvent(new Event('visibilitychange')); }
      else if (frame % 1900 === 960) { env.doc.hidden = false; env.doc.dispatchEvent(new Event('visibilitychange')); }
    },
  },
};

export const PROFILE_IDS = Object.keys(PROFILES);
