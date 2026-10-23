// A practice session for development, layout checks and the end-to-end tests: it walks the real state machine of
// the contract (calibrating, countdown, running, paused, results) with made-up numbers, drives the HUD and draws a
// stand-in scene and self view. It is never used for a real round: boot.ts only offers it in development and test builds.
import type {
  CalibrationCode, CalibrationStatus, PauseReason, PlayerSlot, RunSummary, Session, SessionEvents, SessionState, TwoPlayerCalibrationStatus, Unsubscribe,
} from '../../../core/types/index.ts';
import { glyph } from '../../../core/ui/glyphs.ts';
import type { PlayHud } from '../../../core/ui/hud/hud.ts';
import type { SessionRequest } from './ports.ts';

export interface DemoOptions {
  /** 1 is real time; the tests use 10 or more. */
  timeScale?: number;
  /** Length of the round in seconds (before the time scale). */
  roundSeconds?: number;
  document?: Document;
}

const COMMANDS = ['squat', 'stand', 'squat', 'stand'] as const;

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
  let raf = 0;
  let remaining = roundSeconds;
  let score: [number, number] = [0, 0];

  const emit = <K extends keyof SessionEvents>(k: K, e: SessionEvents[K]): void => { listeners.get(k)?.forEach((cb) => (cb as (e: SessionEvents[K]) => void)(e)); };
  const setState = (s: SessionState): void => { state = s; if (s !== 'paused') reason = null; emit('state', s); };
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
    timer = tick = null;
  };

  const single = (code: CalibrationCode, progress: number, hz = 24): CalibrationStatus => ({ code, progress, ready: code === 'ok', samples: Math.round(progress * 10), hz });
  const steps: [CalibrationCode, number][] = [['no_person', 0], ['too_far', 0], ['feet_out', 0], ['hold', 0.4], ['hold', 0.8], ['ok', 1]];
  const runCalibration = (i = 0): void => {
    if (state !== 'calibrating') return;
    const step = steps[i];
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
      score: two ? Math.max(score[0], score[1]) : score[0], seconds: roundSeconds - Math.max(0, Math.round(remaining)), reps: Math.round(total / 1.4), hits: Math.round(total / 1.4), bestStreak: 6,
      quality: 0.82, metSeconds: 5 * roundSeconds,
      log: [{ t: 3000, kind: 'hips_not_low', ok: false, v: 4 }, { t: 7000, kind: 'hips_not_low', ok: false, v: 5 }, { t: 11000, kind: 'hips_not_up', ok: false, v: 2 }, { t: 5000, kind: 'squat', ok: true }],
      ...(two ? { players: { 1: { score: score[0], metSeconds: 5 * roundSeconds }, 2: { score: score[1], metSeconds: 5 * roundSeconds } } } : {}),
    };
    setState('results');
    emit('over', summary);
  };

  const beginRunning = (): void => {
    hud.set('prompt', { icon: 'squat', text: 'Squat' });
    hud.set('hint', 'Hips 4 cm above the line');
    hud.set('lives', 3);
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
    async start(_gameId: string, options: { input: string }) {
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
