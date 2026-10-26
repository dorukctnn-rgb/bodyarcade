// Firework Jacks, the simulation: the timeline of a run, the rhythm grades, the score, the co-op sky, the variants,
// the reasons a try did not count, determinism, snapshot and restore, and that it is pure. Scripted players (perfect,
// sloppy, idle) stand in for a body and a camera.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mulberry32, streamSeed } from '../../core/loop/rng.ts';
import type { InputEvent, RunSummary } from '../../core/types/index.ts';
import { frameFrom } from '../_shared/frame.ts';
import type { SimEvent } from '../_shared/host.ts';
import { FJ_LEVELS, FJ_TIMING, FireworkSim, makePlan, type FjTiming } from './fireworks.ts';
import { jackBot, type JackBotOptions } from './testing/bots.ts';
import { inputOf, run } from './testing/run.ts';

interface MakeOptions { seed?: number; difficulty?: string; seated?: boolean; silent?: boolean; players?: 1 | 2; audioLatencyMs?: number; timing?: Partial<FjTiming> }

function make(o: MakeOptions = {}): FireworkSim {
  const seed = o.seed ?? 3, players = o.players ?? 1;
  return new FireworkSim({
    setup: {
      start: { seed, difficulty: o.difficulty ?? 'normal', seated: o.seated ?? false, mode: players === 2 ? 'local2' : 'solo' },
      flags: { reducedMotion: false, silent: o.silent ?? false, seated: o.seated ?? false },
      players, audioLatencyMs: o.audioLatencyMs ?? 0, rng: mulberry32(streamSeed(seed, 'course')),
    },
    met: 8,
    ...(o.timing ? { timing: o.timing } : {}),
  });
}

const bot = (sim: FireworkSim, o: JackBotOptions) => jackBot(sim.plan, o);
const types = (events: readonly SimEvent[], type: string): SimEvent[] => events.filter((e) => e.type === type);
const grades = (events: readonly SimEvent[], player = 1): string[] => types(events, 'jack').filter((e) => e['player'] === player).map((e) => e['grade'] as string);

describe('the timeline of a run', () => {
  it('four sets of 45 s with three rests of 20 s, then a 10 s finale: 15000 steps, in that order', () => {
    const sim = make();
    expect(sim.plan.segments.map((s) => s.kind)).toEqual(['work', 'rest', 'work', 'rest', 'work', 'rest', 'work', 'finale']);
    expect(sim.plan.endK).toBe(250 * 60);
    const r = run(sim, inputOf(bot(sim, { mode: 'idle' })));
    expect(r.k).toBe(15000);
    expect(sim.phase).toBe('complete');
    expect(types(r.events, 'set').map((e) => e['set'])).toEqual([0, 1, 2, 3]);
    expect(types(r.events, 'rest')).toHaveLength(3);
    expect(types(r.events, 'finale')).toHaveLength(1);
    expect(types(r.events, 'done')).toHaveLength(1);
    expect(sim.summary().seconds).toBe(250);
  });

  it('the work segments start at 0, 65, 130 and 195 seconds and last 45 s', () => {
    const work = make().plan.segments.filter((s) => s.kind === 'work');
    expect(work.map((s) => s.startK / 60)).toEqual([0, 65, 130, 195]);
    expect(work.map((s) => (s.endK - s.startK) / 60)).toEqual([45, 45, 45, 45]);
  });

  it('the metronome ticks once per beat, four count-in beats first, the first of every four strong', () => {
    const sim = make({ difficulty: 'easy', timing: { sets: 1, workS: 20, finaleS: 2 } });
    const seg = sim.plan.segments[0]!;
    const r = run(sim, inputOf(bot(sim, { mode: 'idle' })));
    const beats = types(r.events, 'beat');
    const expected = Math.ceil((20 * seg.bpm) / 60);
    expect(beats.length).toBeGreaterThanOrEqual(expected - 1);
    expect(beats.length).toBeLessThanOrEqual(expected);
    expect(beats.slice(0, 4).every((b) => b['count'] === true)).toBe(true);
    expect(beats[4]!['count']).toBe(false);
    expect(beats.filter((b) => b['strong']).map((b) => b['n'])).toEqual(beats.filter((_, i) => i % 4 === 0).map((b) => b['n']));
  });

  it('tempo rises from set to set and from level to level, inside 50 to 130 a minute', () => {
    for (const d of ['easy', 'normal', 'hard', 'expert'] as const) {
      const bpm = make({ difficulty: d }).plan.segments.filter((s) => s.kind === 'work').map((s) => s.bpm);
      for (let i = 1; i < bpm.length; i++) expect(bpm[i]!).toBeGreaterThan(bpm[i - 1]! - 4);
      for (const b of bpm) { expect(b).toBeGreaterThanOrEqual(50); expect(b).toBeLessThanOrEqual(130); }
    }
    const first = (d: string): number => make({ difficulty: d }).plan.segments[0]!.bpm;
    expect(first('easy')).toBeLessThan(first('hard'));
    expect(FJ_LEVELS.easy.windows.good).toBeGreaterThan(FJ_LEVELS.expert.windows.good);
  });

  it('an unknown level plays as normal, and "medium" is normal', () => {
    expect(make({ difficulty: 'medium' }).plan.windows).toEqual(FJ_LEVELS.normal.windows);
    expect(make({ difficulty: 'nonsense' }).plan.windows).toEqual(FJ_LEVELS.normal.windows);
  });
});

describe('the rhythm', () => {
  it('a perfect player is Perfect on every judged beat, the score follows the rule, the log adds up to the score', () => {
    const sim = make();
    const r = run(sim, inputOf(bot(sim, { mode: 'perfect' })));
    const g = grades(r.events);
    const scored = g.filter((x) => x !== 'warmup' && x !== 'rest');
    expect(scored.length).toBeGreaterThan(150);
    expect(new Set(scored)).toEqual(new Set(['perfect']));
    const p = sim.playerStates[0]!;
    expect(p.off).toBe(0);
    expect(p.bestStreak).toBe(scored.length);
    // 10 points x 2 for Perfect x the combo (1 + 0.25 per four of the streak, at most 3)
    let want = 0;
    for (let i = 1; i <= scored.length; i++) want += Math.round(10 * 2 * Math.min(3, 1 + 0.25 * Math.floor(i / 4)));
    expect(p.score).toBe(want);
    const s = sim.summary();
    expect(s.score).toBe(want);
    expect(s.quality).toBe(1);
    expect(s.hits).toBe(scored.length);
    expect(s.log.filter((e) => e.ok).reduce((n, e) => n + (e.v ?? 0), 0)).toBe(s.score);
  });

  it('the count-in beats and the rests give fireworks but no points', () => {
    const sim = make({ timing: { sets: 2, workS: 12, restS: 6, finaleS: 3 } });
    const b = bot(sim, { mode: 'perfect' });
    // also jump during the rest
    const rest = sim.plan.segments.find((s) => s.kind === 'rest')!;
    const jumpInRest = (k: number) => (k === rest.startK + 60 ? frameFrom([{ ok: true, events: [{ id: 'jumpingJack', kind: 'rep', t: 0, source: 'pose' }] }]) : inputOf(b)(k));
    const r = run(sim, jumpInRest);
    const all = grades(r.events);
    expect(all).toContain('warmup');
    expect(all).toContain('rest');
    expect(types(r.events, 'jack').filter((e) => e['grade'] === 'warmup' || e['grade'] === 'rest').every((e) => e['pts'] === 0)).toBe(true);
    expect(sim.playerStates[0]!.judged).toBe(all.filter((x) => x === 'perfect' || x === 'good' || x === 'off').length);
  });

  it('the camera delay is taken off: a camera 60 ms faster or 80 ms slower than the game assumes still reads Perfect, a very slow one reads Good', () => {
    const gradesFor = (delayMs: number): Set<string> => {
      const sim = make({ timing: { sets: 1, workS: 14, finaleS: 2 } });
      // the player moves on the beat; the event comes delayMs later, the game takes off its own 100 ms
      const r = run(sim, inputOf(bot(sim, { mode: 'perfect', delayMs })));
      return new Set(grades(r.events).filter((x) => x !== 'warmup'));
    };
    expect(gradesFor(40)).toEqual(new Set(['perfect']));
    expect(gradesFor(100)).toEqual(new Set(['perfect']));
    expect(gradesFor(180)).toEqual(new Set(['perfect']));
    expect(gradesFor(280)).toEqual(new Set(['good']));
  });

  it('a keyboard press (no camera delay) on the beat is Perfect; the same press with the camera delay taken off is late', () => {
    const a = make({ timing: { sets: 1, workS: 14, finaleS: 2 } });
    const keys = run(a, inputOf(bot(a, { mode: 'perfect', source: 'keyboard' })));
    expect(new Set(grades(keys.events).filter((x) => x !== 'warmup'))).toEqual(new Set(['perfect']));
    // an event of the camera with no delay at all is 100 ms early in the game's eyes: still Good or Perfect, never a crash
    const b = make({ timing: { sets: 1, workS: 14, finaleS: 2 } });
    const cam = run(b, inputOf(bot(b, { mode: 'perfect', delayMs: 0 })));
    expect(grades(cam.events).filter((x) => x !== 'warmup').every((x) => x === 'perfect' || x === 'good')).toBe(true);
  });

  it.each([
    ['easy', 120, 'perfect'], ['easy', 220, 'good'], ['easy', 360, 'off'],
    ['normal', 90, 'perfect'], ['normal', 170, 'good'], ['normal', 280, 'off'],
    ['hard', 70, 'perfect'], ['hard', 140, 'good'], ['hard', 240, 'off'],
    ['expert', 55, 'perfect'], ['expert', 115, 'good'], ['expert', 200, 'off'],
  ] as const)('%s: a jack %d ms late is %s', (difficulty, lateMs, want) => {
    const sim = make({ difficulty, timing: { sets: 1, workS: 14, finaleS: 2 } });
    const r = run(sim, inputOf(bot(sim, { mode: 'perfect', offsetMs: lateMs })));
    const g = grades(r.events).filter((x) => x !== 'warmup');
    expect(g.length).toBeGreaterThan(4);
    // far enough from the edge of a window that the quantising to whole steps cannot move it across
    expect(g.filter((x) => x === want).length).toBeGreaterThanOrEqual(g.length - 2);
  });

  it('a second jack on the same beat is a plain one and ends the streak; a missed beat ends it too', () => {
    const sim = make({ timing: { sets: 1, workS: 16, finaleS: 2 } });
    const seg = sim.plan.segments[0]!;
    const base = bot(sim, { mode: 'perfect', skip: (_s, n) => n === 7 });
    const events: SimEvent[] = [];
    // an extra jack 200 ms after the beat-9 jack
    const nineK = seg.startK + Math.round((9 * 3600) / seg.bpm) + 6 + 12;
    const input = (k: number) => {
      const f = inputOf(base)(k);
      if (k !== nineK) return f;
      return frameFrom([{ ok: true, ch: f.players[0]!.ch, events: [...f.players[0]!.events, { id: 'jumpingJack', kind: 'rep', t: 0, source: 'pose' }] }]);
    };
    for (const e of run(sim, input).events) events.push(e);
    const g = grades(events).filter((x) => x !== 'warmup');
    expect(g).toContain('off');
    const streaks = types(events, 'jack').filter((e) => e['grade'] !== 'warmup').map((e) => e['streak'] as number);
    // the streak climbs 1, 2, 3 ... then drops after the skipped beat 7 (beat 8 starts again from 1)
    expect(streaks.slice(0, 3)).toEqual([1, 2, 3]);
    expect(Math.min(...streaks.slice(3))).toBe(0);
  });
});

describe('a sloppy and an idle player', () => {
  it('sloppy scores less than perfect, has off-beat jacks, and says why a try did not count', () => {
    const a = make({ seed: 5 });
    const perfect = run(a, inputOf(bot(a, { mode: 'perfect', seed: 5 })));
    const b = make({ seed: 5 });
    const sloppy = run(b, inputOf(bot(b, { mode: 'sloppy', seed: 5 })));
    expect(b.summary().score).toBeLessThan(a.summary().score);
    expect(b.summary().quality!).toBeLessThan(1);
    expect(b.playerStates[0]!.off).toBeGreaterThan(0);
    const misses = types(sloppy.events, 'miss').map((e) => e['code']);
    expect(misses.length).toBeGreaterThan(2);
    expect(new Set(misses)).toEqual(new Set(['arms_not_up', 'feet_not_wide']));
    expect(types(perfect.events, 'miss')).toHaveLength(0);
    // the misses are in the log as not ok, with the reason as the kind (the results screen counts them)
    expect(new Set(b.summary().log.filter((e) => !e.ok).map((e) => e.kind))).toEqual(new Set(['arms_not_up', 'feet_not_wide']));
  });

  it('idle: no points, no reps, no calories, only "move more" now and then, and the run still ends', () => {
    const sim = make();
    const r = run(sim, inputOf(bot(sim, { mode: 'idle' })));
    const s = sim.summary();
    expect(sim.phase).toBe('complete');
    expect(s.score).toBe(0);
    expect(s.reps).toBe(0);
    expect(s.metSeconds).toBe(0);
    expect(s.quality).toBe(0);
    const codes = new Set(types(r.events, 'miss').map((e) => e['code']));
    expect(codes).toEqual(new Set(['move_more']));
    // one a few seconds apart, not a flood
    expect(types(r.events, 'miss').length).toBeLessThan(25);
    // the finale has only the grand shell to show
    expect(types(r.events, 'burst')).toHaveLength(1);
    expect(types(r.events, 'burst')[0]!['grand']).toBe(true);
  });

  it('a player who is not seen neither scores nor loses anything', () => {
    const sim = make({ timing: { sets: 1, workS: 14, finaleS: 2 } });
    const b = bot(sim, { mode: 'perfect' });
    const r = run(sim, (k) => { const f = b.at(k); return frameFrom([{ ...f, ok: false }]); });
    expect(sim.summary().score).toBe(0);
    expect(types(r.events, 'jack')).toHaveLength(0);
  });
});

describe('the finale', () => {
  it('bursts the fireworks of the show again, at most 72 and a grand shell, over the last seconds, and then completes', () => {
    const sim = make();
    const r = run(sim, inputOf(bot(sim, { mode: 'perfect' })));
    const bursts = types(r.events, 'burst');
    expect(sim.show.length).toBeGreaterThan(150);
    expect(bursts.length).toBe(73);
    expect(bursts.filter((b) => b['grand'])).toHaveLength(1);
    const times = bursts.map((b) => b['t'] as number);
    expect(times).toEqual(times.slice().sort((a, b) => a - b));
    expect(times[0]!).toBeGreaterThan(240_000);
    expect(times.at(-1)!).toBeLessThan(250_000);
    // a burst is one of the show's fireworks: same place, same size
    const shown = new Set(sim.show.map((e) => `${e[1]}|${e[2]}|${e[3]}`));
    for (const b of bursts.filter((x) => !x['grand'])) expect(shown.has(`${b['x']}|${b['size']}|${b['hue']}`)).toBe(true);
  });

  it('a short show replays all of it', () => {
    const sim = make({ timing: { sets: 1, workS: 10, finaleS: 8 } });
    const r = run(sim, inputOf(bot(sim, { mode: 'perfect' })));
    expect(types(r.events, 'burst').length).toBe(sim.show.length + 1);
  });
});

describe('two players on one camera: the co-op sky', () => {
  const duoTiming = { sets: 1, workS: 20, finaleS: 3 };

  it('jacks on the same beat make a double firework and a bonus for both; the pair is counted once', () => {
    const sim = make({ players: 2, timing: duoTiming });
    const a = bot(sim, { mode: 'perfect' }), b = bot(sim, { mode: 'perfect' });
    const r = run(sim, inputOf(a, b));
    const judged = grades(r.events, 1).filter((x) => x === 'perfect').length;
    expect(judged).toBeGreaterThan(8);
    expect(types(r.events, 'double')).toHaveLength(judged);
    expect(sim.doubles).toBe(judged);
    const s = sim.summary();
    expect(s.players![1]!.score).toBe(s.players![2]!.score);
    expect(s.score).toBe(s.players![1]!.score + s.players![2]!.score);
    expect(s.log.filter((e) => e.kind === 'double')).toHaveLength(judged);
    expect(s.log.filter((e) => e.ok).reduce((n, e) => n + (e.v ?? 0), 0)).toBe(s.score);
  });

  it('players a quarter beat apart still match (the match is made on the beat grid, not between them)', () => {
    const sim = make({ players: 2, timing: duoTiming });
    const a = bot(sim, { mode: 'perfect', offsetMs: -60 }), b = bot(sim, { mode: 'perfect', offsetMs: 90 });
    const r = run(sim, inputOf(a, b));
    expect(types(r.events, 'double').length).toBeGreaterThan(8);
  });

  it('one player on the beat and the other off it: no double', () => {
    const sim = make({ players: 2, timing: duoTiming });
    const a = bot(sim, { mode: 'perfect' }), b = bot(sim, { mode: 'perfect', offsetMs: 300 });
    const r = run(sim, inputOf(a, b));
    expect(types(r.events, 'double')).toHaveLength(0);
    expect(grades(r.events, 2).filter((x) => x === 'off').length).toBeGreaterThan(5);
  });

  it('each player has their own streak and score; fireworks go up on their own half of the sky', () => {
    const sim = make({ players: 2, timing: duoTiming });
    const a = bot(sim, { mode: 'perfect' }), b = bot(sim, { mode: 'idle' });
    const r = run(sim, inputOf(a, b));
    const s = sim.summary();
    expect(s.players![2]!.score).toBe(0);
    expect(s.players![1]!.score).toBeGreaterThan(0);
    expect(types(r.events, 'jack').every((e) => e['player'] === 1 && (e['x'] as number) < 0.5)).toBe(true);
    const sim2 = make({ players: 2, timing: duoTiming });
    const r2 = run(sim2, inputOf(bot(sim2, { mode: 'idle' }), bot(sim2, { mode: 'perfect' })));
    expect(types(r2.events, 'jack').every((e) => e['player'] === 2 && (e['x'] as number) >= 0.5)).toBe(true);
  });
});

describe('the ways of playing', () => {
  it('seated plays arm jacks: the feet are not asked about, the variant has less MET, and the reason is only about the arms', () => {
    const sim = make({ seated: true, timing: { sets: 1, workS: 30, finaleS: 2 } });
    expect(sim.variant).toBe('arms');
    const r = run(sim, inputOf(bot(sim, { mode: 'sloppy', seed: 2, armsOnly: true })));
    expect(new Set(types(r.events, 'miss').map((e) => e['code']))).toEqual(new Set(['arms_not_up']));
    const full = make({ timing: { sets: 1, workS: 30, finaleS: 2 } });
    run(full, inputOf(bot(full, { mode: 'perfect' })));
    const seated = make({ seated: true, timing: { sets: 1, workS: 30, finaleS: 2 } });
    run(seated, inputOf(bot(seated, { mode: 'perfect', armsOnly: true })));
    expect(seated.summary().metSeconds).toBeCloseTo(full.summary().metSeconds * 0.4, 0);
  });

  it('quiet plays step jacks: the feet need 1.3 W, not 1.5 W, and the variant is named', () => {
    const sim = make({ silent: true, timing: { sets: 1, workS: 30, finaleS: 2 } });
    expect(sim.variant).toBe('step');
    const full = make({ timing: { sets: 1, workS: 30, finaleS: 2 } });
    run(sim, inputOf(bot(sim, { mode: 'perfect' })));
    run(full, inputOf(bot(full, { mode: 'perfect' })));
    expect(sim.summary().metSeconds).toBeLessThan(full.summary().metSeconds);
  });

  it('seated and quiet together are arm jacks', () => {
    expect(make({ seated: true, silent: true }).variant).toBe('arms');
  });

  it('calories count only the seconds of real movement', () => {
    const sim = make({ timing: { sets: 1, workS: 30, finaleS: 2 } });
    // jack for ten seconds, then stand
    const b = bot(sim, { mode: 'perfect' });
    run(sim, (k) => (k <= 600 ? inputOf(b)(k) : frameFrom([{ ok: true }])));
    const m = sim.summary().metSeconds;
    expect(m).toBeGreaterThan(8 * 9);
    expect(m).toBeLessThan(8 * 14);
  });

  it('the audio output latency is taken off for every source', () => {
    const sim = make({ audioLatencyMs: 80, timing: { sets: 1, workS: 14, finaleS: 2 } });
    // movement on the beat, event after the camera delay of 100 ms AND the 80 ms the sound took to come out: Perfect
    const r = run(sim, inputOf(bot(sim, { mode: 'perfect', delayMs: 180 })));
    expect(new Set(grades(r.events).filter((x) => x !== 'warmup'))).toEqual(new Set(['perfect']));
  });
});

describe('seeded content, snapshot and restore', () => {
  it('the same seed and the same moves give the same events and summary; another seed gives another sky', () => {
    const play = (seed: number): { events: SimEvent[]; summary: RunSummary } => {
      const sim = make({ seed });
      const r = run(sim, inputOf(bot(sim, { mode: 'sloppy', seed })));
      return { events: r.events, summary: sim.summary() };
    };
    const a = play(11), b = play(11), c = play(12);
    expect(b.events).toEqual(a.events);
    expect(b.summary).toEqual(a.summary);
    expect(c.events).not.toEqual(a.events);
    const xs = (e: SimEvent[]): unknown[] => types(e, 'jack').map((x) => x['x']);
    expect(xs(c.events)).not.toEqual(xs(a.events));
  });

  it('positions come from the seed and the index only: a different play of the same seed fires from the same places', () => {
    const a = make({ seed: 21, timing: { sets: 1, workS: 14, finaleS: 2 } });
    const ra = run(a, inputOf(bot(a, { mode: 'perfect' })));
    const b = make({ seed: 21, timing: { sets: 1, workS: 14, finaleS: 2 } });
    const rb = run(b, inputOf(bot(b, { mode: 'perfect', offsetMs: 100 })));
    const n = Math.min(types(ra.events, 'jack').length, types(rb.events, 'jack').length);
    expect(n).toBeGreaterThan(6);
    for (let i = 0; i < n; i++) expect(types(ra.events, 'jack')[i]!['x']).toBe(types(rb.events, 'jack')[i]!['x']);
  });

  it('restore(snapshot()) continues exactly as the original, in a new instance too, and the snapshot is plain JSON', () => {
    const sim = make({ seed: 7 });
    const b = bot(sim, { mode: 'sloppy', seed: 7 });
    const first = run(sim, inputOf(b), { steps: 4000 });
    const snap = JSON.parse(JSON.stringify(sim.snapshot())) as unknown;
    const rest = run(sim, inputOf(b), { from: first.k });
    const other = make({ seed: 7 });
    other.restore(snap);
    const again = run(other, inputOf(b), { from: first.k });
    expect(rest.events.length).toBeGreaterThan(100);
    expect(again.events).toEqual(rest.events);
    expect(other.summary()).toEqual(sim.summary());
  });

  it('a snapshot taken is not changed by what happens next', () => {
    const sim = make();
    const b = bot(sim, { mode: 'perfect' });
    run(sim, inputOf(b), { steps: 1000 });
    const snap = JSON.stringify(sim.snapshot());
    run(sim, inputOf(b), { from: 1000, steps: 1000 });
    expect(JSON.stringify(sim.snapshot())).not.toBe(snap);
    const again = make();
    again.restore(JSON.parse(snap));
    expect(JSON.stringify(again.snapshot())).toBe(snap);
  });

  it('refuses a snapshot of something else', () => {
    expect(() => make().restore({ v: 2 })).toThrow();
    expect(() => make().restore(null)).toThrow();
  });
});

describe('why a try did not count, from the channels of the real detector (its `open` is the smaller of the arms\' and the feet\'s progress)', () => {
  const STAND = { open: 0, armsUp: -1.4, gap: 0.6 };
  const ARMS_ONLY = { open: 0, armsUp: 0.3, gap: 0.6 };          // the hands over the head, the feet together
  const FEET_ONLY = { open: 0.05, armsUp: -1.3, gap: 1.7 };      // the feet wide, the hands down
  const FEET_MID_ARMS = { open: 0.1, armsUp: -0.3, gap: 1.7 };   // the feet wide, the hands only to the shoulders
  const SWING = { open: 0, armsUp: -0.9, gap: 0.6 };             // the hands swinging a little at the sides

  /** Steps a one player sim through `[channels, steps]` pieces, from step 1, with no detector events; returns the misses it said. */
  function say(sim: FireworkSim, pieces: [Record<string, number>, number][], events: (k: number) => readonly InputEvent[] = () => []): string[] {
    const said: string[] = [];
    let k = 0;
    for (const [ch, n] of pieces) {
      for (let i = 0; i < n; i++) {
        k++;
        for (const e of sim.step(frameFrom([{ ok: true, ch, events: events(k) }], 'pose'))) if (e.type === 'miss') said.push(String(e['code']));
      }
    }
    return said;
  }

  it('the hands over the head with the feet together: "Feet not wide enough" once the hands come down', () => {
    const sim = make();
    expect(say(sim, [[STAND, 120], [ARMS_ONLY, 40], [STAND, 60]])).toEqual(['feet_not_wide']);
    expect(sim.summary().log.filter((e) => !e.ok).map((e) => e.kind)).toEqual(['feet_not_wide']);
  });

  it('the feet wide with the hands only to the shoulders: "Arms not high enough"; with the hands down as well, the same', () => {
    expect(say(make(), [[STAND, 120], [FEET_MID_ARMS, 40], [STAND, 60]])).toEqual(['arms_not_up']);
    expect(say(make(), [[STAND, 120], [FEET_ONLY, 40], [STAND, 60]])).toEqual(['arms_not_up']);
  });

  it('standing still, and the hands swinging a little at the sides: nothing is said', () => {
    expect(say(make(), [[STAND, 200], [SWING, 100], [STAND, 100]])).toEqual([]);
  });

  it('a jack the detector counts says nothing, whatever the channels did on the way (arms first, then the feet, then both open)', () => {
    const rep = (k: number) => (k === 160 ? [{ id: 'jumpingJack' as const, kind: 'rep' as const, t: 0, source: 'pose' as const }] : []);
    expect(say(make(), [[STAND, 120], [ARMS_ONLY, 30], [{ open: 1, armsUp: 0.3, gap: 1.7 }, 30], [STAND, 60]], rep)).toEqual([]);
  });

  it('the same try again and again is told once every second and a half at most', () => {
    const sim = make();
    const said = say(sim, [[STAND, 120], [ARMS_ONLY, 20], [STAND, 10], [ARMS_ONLY, 20], [STAND, 10], [ARMS_ONLY, 20], [STAND, 10], [ARMS_ONLY, 20], [STAND, 60]]);
    expect(said).toEqual(['feet_not_wide', 'feet_not_wide']);
  });

  it('seated (arm jacks): the hands only to the shoulders say "Arms not high enough", the hands over the head say nothing, and the feet are never asked about', () => {
    const seated = (): FireworkSim => make({ seated: true });
    const upper = { open: 0, armsUp: -0.2, gap: 0 };
    expect(say(seated(), [[{ open: 0, armsUp: -1.4, gap: 0 }, 120], [upper, 40], [{ open: 0, armsUp: -1.4, gap: 0 }, 60]])).toEqual(['arms_not_up']);
    expect(say(seated(), [[{ open: 0, armsUp: -1.4, gap: 0 }, 120], [{ open: 1, armsUp: 0.3, gap: 0 }, 40], [{ open: 0, armsUp: -1.4, gap: 0 }, 60]], (k) => (k === 140 ? [{ id: 'jumpingJack' as const, kind: 'rep' as const, t: 0, source: 'pose' as const }] : []))).toEqual([]);
  });

  it('quiet (step jacks): one foot out is wide enough at 1.3 W, and a step that is smaller is told', () => {
    const quiet = (): FireworkSim => make({ silent: true });
    expect(say(quiet(), [[STAND, 120], [{ open: 0.2, armsUp: 0.3, gap: 1.0 }, 40], [STAND, 60]])).toEqual(['feet_not_wide']);
    expect(say(quiet(), [[STAND, 120], [{ open: 0.9, armsUp: 0.3, gap: 1.4 }, 40], [STAND, 60]])).toEqual([]);
  });
});

describe('the plan', () => {
  it('makePlan is a function of the level, the timing and the stream', () => {
    const a = makePlan('normal', FJ_TIMING, mulberry32(4)), b = makePlan('normal', FJ_TIMING, mulberry32(4));
    expect(b).toEqual(a);
  });
});

describe('purity', () => {
  it('the simulation has no clock, no Math.random and no DOM', () => {
    for (const f of ['fireworks.ts', 'kit.ts']) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(src, f).not.toMatch(/Math\.random|performance\.now|Date\.now|document\.|window\.|requestAnimationFrame/);
    }
  });
});
