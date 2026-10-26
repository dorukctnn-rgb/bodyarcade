// The target-hit template (C) on the platform's Game contract. One function makes any of the three games from its manifest and
// its rules: Star Catch, Pad Work, Reaction Tag.
//
// - step(): the engine, pure and fixed-step (see engine.ts). The events it returns are also kept for the picture.
// - render(alpha): everything that is allowed to have effects, kept out of the simulation: the sounds the steps queued
//   (ctx.audio), the HUD (score, time, streak, the command, the reason a move missed), and the mirror view. The view sits
//   behind the small TargetView interface so the game runs without a canvas (tests, a server) and the drawing can change
//   without touching the rules.
// - snapshot()/restore(): the engine's plain data; restore(snapshot()) continues identically.
// - local2: each player gets their own lane (engine.ts), their own score and reason strip in the split HUD when the HUD has
//   them (PlayHud.setPlayer), and their half of the mirror.
import type {
  BodyProfile, Game, GameContext, GameEvent, GameManifest, Hud, InputFrame, PlayerSlot, PoseFrame, PoseService, RunSummary, StartOptions, StepResult,
} from '../../core/types/index.ts';
import type { CallId } from './coach.ts';
import { browserSpeech, createCoachVoice, pickVoiceLang, type CoachVoice, type SpeechLike, type VoiceAudio, type VoicePack } from './coach-voice.ts';
import { TargetEngine, type EngineConfig } from './engine.ts';
import { nominalProfile } from './envelope.ts';
import { callText, english, TARGET_NAMESPACE, type Lang } from './strings.ts';
import { levelOf, type BaseSpec, type Hint, type Prompt, type Rules, type StartInput, type ViewState } from './types.ts';

/** What the mirror view is told when a run starts. */
export interface ViewBegin {
  game: string;
  players: 1 | 2;
  /** No camera: the hands are cursors and there is no picture to draw. */
  keyboard: boolean;
  seated: boolean;
  profiles: BodyProfile[];
}

/** What it is given for every frame it draws. */
export interface ViewFrame {
  /** What happened in the steps since the last frame (hits, misses ...), for the effects. */
  events: readonly GameEvent[];
  alpha: number;
  /** Real milliseconds since the last frame, for effects. */
  dtMs: number;
  /** The latest pose frame, to draw the player's body; null in a keyboard round or before the first frame. */
  pose: PoseFrame | null;
  reducedMotion: boolean;
  /** The words of the game in the player's language. */
  say(key: string, vars?: Record<string, string | number>): string;
}

export interface TargetView {
  begin(o: ViewBegin): void;
  draw(v: ViewState, f: ViewFrame): void;
  dispose(): void;
}

export interface TargetGameOptions {
  /** Rounds and rest (s) instead of the rules' own: tools and tests play shorter runs. */
  rounds?: number;
  restSec?: number;
  latencyMs?: number;
  /** Builds the view from the context (the games' index.ts give the mirror view on a Scene2D kit); none: the game runs without a picture. */
  view?: (ctx: GameContext, say: ViewFrame['say']) => TargetView | null;
  /**
   * The clips of the coach's voice, for a game whose rules make calls (coach.ts). The calls are shown as captions whatever this is; without
   * a pack, or when the clips cannot be had, they are spoken by the browser's own voice if it has one in the language, or not at all.
   */
  voice?: VoicePack;
  /** Tools and tests: another way to get the bytes of a clip, and another fallback voice (null: none; left out: the browser's). */
  voiceIo?: { fetchBytes?: (url: string) => Promise<ArrayBuffer>; speech?: SpeechLike | null };
}

/** The Game plus a read-only look at the engine, for tools and tests. */
export interface TargetGame<S extends BaseSpec> extends Game {
  readonly engine: TargetEngine<S> | null;
}

interface Snap { v: 1; id: string; opts: StartOptions; engine: unknown }

/** PlayHud has per-player slots for two players; the contract's Hud does not, so the game asks the object what it has. */
interface DuoHud { setPlayer(player: PlayerSlot, slot: 'score' | 'hint', v: string | number): void }
const duoOf = (h: Hud): DuoHud | null => (typeof (h as Partial<DuoHud>).setPlayer === 'function' ? (h as unknown as DuoHud) : null);

export function createTargetGame<S extends BaseSpec>(manifest: GameManifest, rules: Rules<S>, o: TargetGameOptions = {}): TargetGame<S> {
  let ctx: GameContext | null = null;
  let engine: TargetEngine<S> | null = null;
  let view: TargetView | null = null;
  let coach: CoachVoice | null = null;
  let opts: StartOptions | null = null;
  let pending: GameEvent[] = [];
  let pose: PoseFrame | null = null;
  let offPose: (() => void) | null = null;
  let lastDraw = 0;
  const shown = new Map<string, string | number>();

  const need = (): TargetEngine<S> => {
    if (!engine) throw new Error('Call start() before step().');
    return engine;
  };

  /** `target.<key>` from the shell when it has the translations; the English of this package when it has not. */
  const say: ViewFrame['say'] = (key, vars) => {
    const full = `${TARGET_NAMESPACE}.${key}`;
    const t = ctx?.t(full, vars);
    if (t !== undefined && t !== '' && t !== full) return t;
    return english(key, vars) ?? key;
  };

  function config(): EngineConfig {
    const c: EngineConfig = { durationSec: manifest.durationSec, met: manifest.met };
    if (o.rounds !== undefined) c.rounds = o.rounds;
    if (o.restSec !== undefined) c.restSec = o.restSec;
    if (o.latencyMs !== undefined) c.latencyMs = o.latencyMs;
    return c;
  }

  function hudSet(slot: Parameters<Hud['set']>[0], cache: string, v: Parameters<Hud['set']>[1]): void {
    if (!ctx || shown.get(slot) === cache) return;
    shown.set(slot, cache);
    ctx.hud.set(slot, v);
  }

  /** The sentence for a reason: this game's own words, then the shell's sentence for the movement library's code, then a plain one. */
  function hintText(h: Hint): string {
    const keys = [h.side ? `reason.${h.code}.${h.side}` : '', `reason.${h.code}`].filter(Boolean);
    for (const k of keys) if (english(k) !== null) return say(k);
    const shell = ctx?.t(`miss.${h.code}`);
    if (shell && shell !== `miss.${h.code}`) return shell;
    return say('reason.other');
  }

  function promptOf(p: Prompt): { icon?: string; text: string } {
    const text = p.key === 'rest' ? say('rest') : say(p.key, p.vars);
    return { ...(p.icon ? { icon: p.icon } : {}), text };
  }

  const game: TargetGame<S> = {
    manifest,

    get engine() { return engine; },

    async init(c: GameContext): Promise<void> {
      ctx = c;
      view = o.view?.(c, say) ?? null;
      if (o.voice && rules.calls) {
        // The language of the voice is what the game's words say it is (voice.lang): the app's language where the pack has a voice in it,
        // English otherwise. The clips are fetched now, while the player is being calibrated, and not before the game is chosen.
        const pack = o.voice;
        const lang = pickVoiceLang(pack, say('voice.lang'));
        coach = createCoachVoice({
          audio: c.audio as unknown as VoiceAudio, pack, lang, quiet: c.flags.silent,
          text: (l, id) => callText(l as Lang, id) ?? '',
          ...(o.voiceIo?.fetchBytes ? { fetchBytes: o.voiceIo.fetchBytes } : {}),
          speech: o.voiceIo && 'speech' in o.voiceIo ? (o.voiceIo.speech ?? null) : browserSpeech(),
          onError: () => { /* a clip that did not load: the call falls back to the browser's voice */ },
        });
        void coach.preload().catch(() => undefined);
      }
      const p = c.pose as Partial<PoseService>;
      if (typeof p.onFrame === 'function') offPose = p.onFrame((f) => { pose = f; });
    },

    start(s: StartOptions): void {
      const c = ctx;
      if (!c) throw new Error('Call init() before start().');
      opts = { ...s };
      coach?.setQuiet(c.flags.silent);
      const two = s.mode === 'local2';
      const seated = s.seated || c.flags.seated;
      const p1 = two ? (s.profiles?.[1] ?? s.profile ?? nominalProfile({ seated })) : s.profile;
      const profiles: StartInput['profiles'] = two ? [p1, s.profiles?.[2] ?? p1] : [p1];
      engine = new TargetEngine<S>(rules, config());
      engine.start({ rng: c.rng('course'), level: levelOf(s.difficulty), seated, quiet: c.flags.silent, profiles });
      pending = [];
      shown.clear();
      view?.begin({
        game: rules.id, players: two ? 2 : 1, keyboard: p1 === null, seated,
        profiles: engine.view().lanes.map((l) => l.profile),
      });
    },

    step(_dt: number, input: InputFrame): StepResult {
      const e = need();
      const out = e.step(input);
      if (out.events.length > 0) pending.push(...out.events);
      return { events: out.events, phase: out.phase };
    },

    render(alpha: number): void {
      const e = engine, c = ctx;
      if (!e || !c) return;
      const v = e.view();

      // sounds queued by the steps
      for (const cue of e.takeCues()) {
        try { c.audio?.play?.(cue); } catch { /* a sound that cannot play must never stop a round */ }
      }

      // announcements the player's screen reader gets: round starts and rests, nothing per target
      for (const ev of pending) {
        if (ev.type === 'round') c.hud.announce(say('announce_round', { n: ev.n as number, of: ev.of as number }));
        else if (ev.type === 'rest') c.hud.announce(say('announce_rest'));
        // the coach's calls: spoken now (a call that is far too late is dropped, never queued), and drawn as a caption by the view
        else if (ev.type === 'call' && coach) {
          try { coach.say(ev.id as CallId, { lateMs: v.t - (ev.at as number) }); } catch { /* a voice that fails must never stop a round */ }
        }
      }

      // the HUD
      const hud = c.hud;
      const duo = v.lanes.length === 2 ? duoOf(hud) : null;
      hudSet('timer', String(Math.ceil(v.left / 1000)), Math.max(0, Math.ceil(v.left / 1000)));
      const lanes = e.laneCount;
      for (let i = 0; i < lanes; i++) {
        const slot = (i + 1) as PlayerSlot;
        const lane = e.lane(slot);
        if (!lane) continue;
        const score = lane.state.stats.score;
        const hint = v.phase === 'rest' ? say('rest_hint') : lane.state.hint ? hintText(lane.state.hint) : '';
        if (duo) {
          if (shown.get(`score${slot}`) !== score) { shown.set(`score${slot}`, score); duo.setPlayer(slot, 'score', score); }
          if (shown.get(`hint${slot}`) !== hint) { shown.set(`hint${slot}`, hint); duo.setPlayer(slot, 'hint', hint); }
        } else if (i === 0) {
          hudSet('score', String(score), score);
          hudSet('combo', String(lane.state.stats.streak), lane.state.stats.streak);
          hudSet('hint', hint, hint);
        }
      }
      if (lanes === 2 && !duo) {
        // a HUD without per-player slots shows the better score
        const best = Math.max(...v.lanes.map((l) => l.score));
        hudSet('score', String(best), best);
      }
      const prompt = e.prompt(1);
      if (prompt) {
        const p = promptOf(prompt);
        hudSet('prompt', `${p.icon ?? ''}|${p.text}`, p.icon ? { icon: p.icon, text: p.text } : p.text);
      } else hudSet('prompt', '', '');

      // the picture
      if (view) {
        const now = typeof performance !== 'undefined' ? performance.now() : 0;
        const dtMs = lastDraw > 0 ? Math.min(100, Math.max(0, now - lastDraw)) : 16;
        lastDraw = now;
        view.draw(v, { events: pending, alpha, dtMs, pose, reducedMotion: c.flags.reducedMotion, say });
      }
      pending = [];
    },

    snapshot(): Snap {
      const e = need();
      return { v: 1, id: rules.id, opts: { ...(opts as StartOptions) }, engine: e.snapshot() };
    },

    restore(raw: unknown): void {
      const s = raw as Snap;
      if (!s || s.v !== 1 || s.id !== rules.id) throw new Error(`Not a ${rules.id} snapshot.`);
      opts = { ...s.opts };
      engine = new TargetEngine<S>(rules, config());
      engine.restore(s.engine);
      pending = [];
      shown.clear();
      const v = engine.view();
      view?.begin({
        game: rules.id, players: v.lanes.length === 2 ? 2 : 1, keyboard: v.lanes[0]?.keyboard ?? false, seated: engine.seated,
        profiles: v.lanes.map((l) => l.profile),
      });
    },

    summary(): RunSummary {
      return need().summary();
    },

    dispose(): void {
      offPose?.();
      offPose = null;
      coach?.dispose();
      coach = null;
      view?.dispose();
      view = null;
      engine = null;
      ctx = null;
      pending = [];
      pose = null;
      shown.clear();
    },
  };
  return game;
}

