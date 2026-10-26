// A practice session for development, layout checks and the end-to-end tests: it walks the real state machine of
// the contract (calibrating, countdown, running, paused, results) with made-up numbers, drives the HUD and draws a
// stand-in scene and self view. It is never used for a real round: boot.ts only offers it in development and test builds.
import type {
  CalibrationCode, CalibrationStatus, PauseReason, PlayerSlot, RunSummary, Session, SessionEvents, SessionState, TwoPlayerCalibrationStatus, Unsubscribe,
} from '../../../core/types/index.ts';
import { makeSchedule, scoreOf, specFor, type Obstacle } from '../../../core/net/schedule.ts';
import { DEFAULT_SHAPE, synthPose } from '../../../core/pose/synth.ts';
import type { ObstacleResult } from '../../../core/types/net.ts';
import { glyph } from '../../../core/ui/glyphs.ts';
import type { PlayHud } from '../../../core/ui/hud/hud.ts';
import type { DuelFeed } from './duel.ts';
import type { SessionRequest } from './ports.ts';

export interface DemoOptions {
  /** 1 is real time; the tests use 10 or more. */
  timeScale?: number;
  /** Length of the round in seconds (before the time scale). */
  roundSeconds?: number;
  /** The person is at a desk: calibration sees head and shoulders without the hips until the round is a seated one. */
  desk?: boolean;
  document?: Document;
}

const COMMANDS = ['squat', 'stand', 'squat', 'stand'] as const;

/** The moves the practice player misses, and when (milliseconds into the round, before the time scale): the same three the summary lists. */
const MISSES = [{ t: 3000, kind: 'hips_not_low', v: 4 }, { t: 7000, kind: 'hips_not_low', v: 5 }, { t: 11000, kind: 'hips_not_up', v: 2 }] as const;
/** The practice player squats once in this long. */
const SQUAT_MS = 2400;
/** A pose frame of the camera, as often as a camera gives one. */
const FEED_MS = 33;

type Listener = (e: never) => void;

export function createDemoSession(r: SessionRequest, o: DemoOptions = {}): Session & { loseSecondPlayer(): void; returnSecondPlayer(): void } {
  const doc = o.document ?? document;
  const scale = Math.max(1, o.timeScale ?? 1);
  const roundSeconds = o.roundSeconds ?? 20;
  const two = r.setup.players === 2;
  const listeners = new Map<keyof SessionEvents, Set<Listener>>();
  let state: SessionState = 'idle';
  let reason: PauseReason | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let tick: ReturnType<typeof setInterval> | null = null;
  let feed: ReturnType<typeof setInterval> | null = null;
  /** Where the replay of a miss is made from (a round with the camera): the practice player's skeleton, and its misses as they happen. */
  const tap = r.replay ?? null;
  let raf = 0;
  let remaining = roundSeconds;
  let score: [number, number] = [0, 0];
  /** A race ends when its own clock says so: how long it lasted, for the summary. */
  let raced: number | null = null;

  const emit = <K extends keyof SessionEvents>(k: K, e: SessionEvents[K]): void => { listeners.get(k)?.forEach((cb) => (cb as (e: SessionEvents[K]) => void)(e)); };
  const setState = (s: SessionState): void => { state = s; if (s !== 'paused') reason = null; tap?.running(s === 'running'); emit('state', s); };
  const ms = (n: number): number => Math.max(1, Math.round(n / scale));
  const later = (fn: () => void, n: number): void => { timer = setTimeout(fn, ms(n)); };
  const hud = r.stage.hud;
  const duoHud = (): PlayHud | null => ('setPlayer' in hud ? (hud as unknown as PlayHud) : null);

  // The stand-in scene: a sky, a ground line and a moving block, so a screenshot of a round is not empty.
  const canvas = doc.createElement('canvas');
  canvas.className = 'ba-demo-canvas';
  r.stage.scene.append(canvas);
  const paint = (t: number): void => {
    const w = (canvas.width = r.stage.scene.clientWidth || 640);
    const h = (canvas.height = r.stage.scene.clientHeight || 360);
    const g = canvas.getContext('2d');
    if (!g) return;
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#C9C5F2'); sky.addColorStop(1, '#7C77D6');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2B2248'; g.fillRect(0, h * 0.86, w, h * 0.14);
    g.fillStyle = '#FF4F6E'; g.fillRect(0, h * 0.86, w, 5);
    const x = ((t / 14) % (w + 120)) - 60;
    g.fillStyle = '#E4F4FF';
    g.fillRect(w - x - 30, 0, 54, h * 0.38); g.fillRect(w - x - 30, h * 0.62, 54, h * 0.24);
    g.fillStyle = '#FF4F6E';
    g.beginPath(); g.arc(w * 0.28, h * (0.5 + 0.08 * Math.sin(t / 380)), Math.min(w, h) * 0.05, 0, Math.PI * 2); g.fill();
    raf = doc.defaultView?.requestAnimationFrame(paint) ?? 0;
  };

  // The stand-in self view: the pictogram of a person, or of two.
  r.stage.pip.innerHTML = `<div class="ba-demo-self" aria-hidden="true">${glyph('squat', { ink: '#F4F2F8', floor: false, size: '100%', decorative: true }).value}${two ? glyph('stand', { ink: '#F4F2F8', floor: false, size: '100%', decorative: true }).value : ''}</div>`;

  const stopTimers = (): void => {
    if (timer) clearTimeout(timer);
    if (tick) clearInterval(tick);
    if (feed) clearInterval(feed);
    timer = tick = feed = null;
  };

  /**
   * A practice player on the camera: a figure that squats now and then, a frame every FEED_MS of the game's own time (the frames that a busy machine's timer
   * was late for are made up for, with their own times, so a window holds what a camera would have given), and the misses written to the log as their time comes.
   */
  const startFeed = (): void => {
    if (!tap) return;
    const live: RunSummary['log'] = [];
    const clock = (): number => (doc.defaultView?.performance.now() ?? Date.now()) * scale;
    let next = clock();
    let at = 0;
    feed = setInterval(() => {
      if (state !== 'running') { next = clock(); return; }
      const t = clock();
      for (let n = 0; next <= t && n < 90; n++, next += FEED_MS) {
        at += FEED_MS;
        const depth = 0.5 - 0.5 * Math.cos((2 * Math.PI * at) / SQUAT_MS);
        tap.frame(synthPose({ ...DEFAULT_SHAPE, aspect: 16 / 9 }, { drop: depth * 0.9 }), 16 / 9, next);
      }
      if (next < t) next = t;
      const played = (roundSeconds - remaining) * 1000;
      for (let n = live.length; n < MISSES.length && (MISSES[n] as (typeof MISSES)[number]).t <= played; n++) {
        const m = MISSES[n] as (typeof MISSES)[number];
        live.push({ t: m.t, kind: m.kind, ok: false, v: m.v });
        tap.log(live);
      }
    }, ms(FEED_MS));
  };

  const single = (code: CalibrationCode, progress: number, hz = 24): CalibrationStatus => ({ code, progress, ready: code === 'ok', samples: Math.round(progress * 10), hz });
  const steps: [CalibrationCode, number][] = [['no_person', 0], ['too_far', 0], ['feet_out', 0], ['hold', 0.4], ['hold', 0.8], ['ok', 1]];
  // A person at a desk: the picture ends at the chest, so the hips are never found and the round does not start.
  const deskSteps: [CalibrationCode, number][] = [['no_person', 0], ['hips_out', 0]];
  let seated = false;
  const runCalibration = (i = 0): void => {
    if (state !== 'calibrating') return;
    const atDesk = o.desk === true && !seated;
    const step = atDesk ? (deskSteps[Math.min(i, deskSteps.length - 1)] as [CalibrationCode, number]) : steps[i];
    if (!step) { startCountdown(); return; }
    const one = single(step[0], step[1]);
    if (two) {
      const st: TwoPlayerCalibrationStatus = {
        ready: one.ready, progress: one.progress, hz: one.hz, code: step[0] === 'no_person' ? 'one_person' : step[0],
        guidance: step[0] === 'no_person' ? { player: 2, action: 'step_in' } : { action: 'none' },
        players: { 1: one, 2: single(step[0] === 'no_person' ? 'no_person' : step[0], step[1]) },
      };
      emit('calibration', st);
    } else emit('calibration', one);
    later(() => runCalibration(i + 1), 450);
  };

  const startCountdown = (): void => {
    setState('countdown');
    emit('countdown', { remaining: 3 });
    later(() => { emit('countdown', { remaining: 2 }); later(() => { emit('countdown', { remaining: 1 }); later(() => { emit('countdown', { remaining: 0 }); setState('running'); beginRunning(); }, 1000); }, 1000); }, 1000);
  };

  const finish = (): void => {
    stopTimers();
    const total = score[0] + score[1];
    const summary: RunSummary = {
      score: two ? Math.max(score[0], score[1]) : score[0], seconds: raced ?? roundSeconds - Math.max(0, Math.round(remaining)), reps: Math.round(total / 1.4), hits: Math.round(total / 1.4), bestStreak: 6,
      quality: 0.82, metSeconds: 5 * roundSeconds,
      log: [{ t: 3000, kind: 'hips_not_low', ok: false, v: 4 }, { t: 7000, kind: 'hips_not_low', ok: false, v: 5 }, { t: 11000, kind: 'hips_not_up', ok: false, v: 2 }, { t: 5000, kind: 'squat', ok: true }],
      ...(two ? { players: { 1: { score: score[0], metSeconds: 5 * roundSeconds }, 2: { score: score[1], metSeconds: 5 * roundSeconds } } } : {}),
    };
    setState('results');
    emit('over', summary);
  };

  /**
   * A race (against a recording): the practice player passes three obstacles in four, by the race's own clock (the real feed of
   * core/net/ghost-race.ts), so the rows under the score, the result and "Race again" can be tried without a camera.
   */
  const raceRound = (feed: DuelFeed): void => {
    const mine: ObstacleResult[] = [];
    const done = new Set<number>();
    let schedule: Obstacle[] = [];
    let seed = -1;
    tick = setInterval(() => {
      if (state !== 'running') return;
      const m = feed.match();
      if (!m) return;
      if (m.seed !== seed) { seed = m.seed; schedule = makeSchedule(m.seed, m.durationMs, specFor(m.gameId)); }
      const t = feed.time();
      // the judge ended the race first (the time ran out on its clock, or everybody else left): what was done is final
      if (feed.phase() === 'over') { raced = Math.round(Math.min(t, m.durationMs) / 1000); feed.finish(mine); finish(); return; }
      if (feed.phase() !== 'run') return;
      for (const ob of schedule) {
        if (ob.t > t || done.has(ob.id)) continue;
        done.add(ob.id);
        const k = ob.id % 4 === 0 ? 'hit' : 'pass';
        mine.push({ ob: ob.id, k });
        feed.report(ob.id, k);
      }
      score = [scoreOf(schedule, mine).score, 0];
      hud.set('score', score[0]);
      hud.set('timer', Math.max(0, (m.durationMs - t) / 1000));
      if (t >= m.durationMs) {
        raced = Math.round(m.durationMs / 1000);
        feed.finish(mine);
        finish();
      }
    }, ms(100));
  };

  const beginRunning = (): void => {
    hud.set('prompt', { icon: 'squat', text: 'Squat' });
    hud.set('hint', 'Hips 4 cm above the line');
    hud.set('lives', 3);
    if (r.race) { raceRound(r.race.feed); return; }
    startFeed();
    let n = 0;
    tick = setInterval(() => {
      if (state !== 'running') return;
      remaining -= 0.25;
      n += 1;
      if (n % 3 === 0) {
        score[0] += 1;
        if (two) score[1] += n % 6 === 0 ? 2 : 1;
        const c = COMMANDS[((n / 3) | 0) % COMMANDS.length] ?? 'squat';
        hud.set('prompt', { icon: c, text: c === 'squat' ? 'Squat' : 'Stand' });
      }
      const d = duoHud();
      if (two && d) { d.setPlayer(1, 'score', score[0]); d.setPlayer(2, 'score', score[1]); d.setPlayer(1, 'hint', 'Hips 4 cm above the line'); d.setPlayer(2, 'hint', 'Good depth'); }
      else hud.set('score', score[0]);
      hud.set('combo', Math.floor(score[0] / 3));
      hud.set('timer', Math.max(0, remaining));
      if (remaining <= 0) finish();
    }, ms(250));
  };

  const api = {
    get state() { return state; },
    get pauseReason() { return reason; },
    async start(_gameId: string, options: { input: string; seated?: boolean }) {
      seated = options.seated === true;
      tap?.reset();
      remaining = roundSeconds; score = [0, 0];
      hud.set('score', 0); hud.set('timer', roundSeconds);
      raf = doc.defaultView?.requestAnimationFrame(paint) ?? 0;
      setState('setup');
      later(() => {
        if (options.input === 'camera') { setState('calibrating'); runCalibration(); } else startCountdown();
      }, 300);
    },
    pause(why: PauseReason) {
      if (state !== 'running' && state !== 'countdown') return;
      reason = why;
      setState('paused');
      emit('pause', why);
    },
    async resume() {
      if (state !== 'paused') return;
      setState('running');
    },
    async recalibrate() {
      stopTimers();
      setState('calibrating');
      runCalibration();
    },
    quit() {
      stopTimers();
      if (raf) doc.defaultView?.cancelAnimationFrame(raf);
      canvas.remove();
      r.stage.pip.innerHTML = '';
      setState('idle');
    },
    on<K extends keyof SessionEvents>(k: K, cb: (e: SessionEvents[K]) => void): Unsubscribe {
      const set = listeners.get(k) ?? new Set<Listener>();
      listeners.set(k, set);
      set.add(cb as Listener);
      return () => { set.delete(cb as Listener); };
    },
    /** For tests: the second player leaves the frame, and comes back. */
    loseSecondPlayer() { const p: PlayerSlot = 2; reason = 'player_lost'; setState('paused'); emit('pause', 'player_lost'); emit('player', { player: p, present: false }); },
    returnSecondPlayer() { emit('player', { player: 2, present: true }); setState('running'); },
  };
  return api as Session & { loseSecondPlayer(): void; returnSecondPlayer(): void };
}
