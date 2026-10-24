// A recording of a race (ghost.ts): what it keeps, what it refuses, the code that carries it, the practice partner and the skeleton.
import { describe, expect, it } from 'vitest';
import { MAX_DURATION_MS, MIN_DURATION_MS, type ObstacleResult } from '../types/net.ts';
import { createI18n } from '../ui/i18n/index.ts';
import {
  BOT_LEVELS, BOT_PASS, GHOST_HZ, TrackRecorder, botRun, checkRun, courseOf, decodeRun, encodeRun, ghostLabel, outcomeString, resultsOf, runFromResults, runScore, standingAt, trackPoseAt, type GhostRun,
} from './ghost.ts';
import { POSE_NUMBERS } from './pose-frame.ts';
import { scoreOf } from './schedule.ts';

const AT = Date.UTC(2026, 9, 24, 14, 30);

function made(o: Partial<{ gameId: string; seed: number; durationMs: number; pass: number; name: string; source: GhostRun['source']; at: number }> = {}): GhostRun {
  const gameId = o.gameId ?? 'squat-flap', seed = o.seed ?? 4242, durationMs = o.durationMs ?? 45_000;
  const course = courseOf({ gameId, seed, durationMs });
  const results: ObstacleResult[] = course.map((ob, i) => ({ ob: ob.id, k: (i * 7 + seed) % 10 < (o.pass ?? 7) ? 'pass' : 'hit' }));
  return runFromResults({ gameId, seed, durationMs, results, name: o.name ?? 'Ada', at: o.at ?? AT, source: o.source ?? 'friend' });
}

describe('what a recording keeps', () => {
  it('is one character per obstacle of the Room\'s own course, and its score is the Room\'s score of those results', () => {
    const run = made();
    const course = courseOf(run);
    expect(run.outcomes).toHaveLength(course.length);
    expect(course.length).toBeGreaterThan(10);
    expect(/^[ph]+$/.test(run.outcomes)).toBe(true);
    expect(runScore(run)).toEqual(scoreOf(course, resultsOf(run)));
    expect(outcomeString(course, resultsOf(run))).toBe(run.outcomes);
    // obstacles that were never played stay out of the results and out of the score
    const half = { ...run, outcomes: run.outcomes.slice(0, 5) + '.'.repeat(run.outcomes.length - 5) };
    expect(resultsOf(half)).toHaveLength(5);
    expect(runScore(half).passes + runScore(half).hits).toBe(5);
    expect(run.at % 60_000).toBe(0);
  });

  it('stands where the Room would have it at any moment of the match, and ends on the full score', () => {
    for (const seed of [1, 99, 31337, 0xdeadbeef]) {
      const run = made({ seed, pass: 8 });
      const course = courseOf(run);
      expect(standingAt(run, -1)).toEqual({ score: 0, combo: 0, passes: 0, hits: 0 });
      expect(standingAt(run, Infinity).score).toBe(runScore(run).score);
      // the standing at an obstacle's time counts that obstacle, and is the Room's score of the results up to it
      course.forEach((o, i) => {
        const upTo = resultsOf(run).slice(0, i + 1);
        expect(standingAt(run, o.t, course).score).toBe(scoreOf(course, upTo).score);
      });
      // it never goes down
      let last = 0;
      for (let t = 0; t <= run.durationMs; t += 500) { const s = standingAt(run, t, course).score; expect(s).toBeGreaterThanOrEqual(last); last = s; }
    }
  });

  it('is labelled by what it is: your best, a friend\'s recording (with the name), a recording without a name, a bot', () => {
    expect(ghostLabel(made({ source: 'own', name: 'Me' })).key).toBe('ghost.label.own');
    expect(ghostLabel(made({ source: 'friend', name: 'Ada' }))).toMatchObject({ key: 'ghost.label.friend', name: 'Ada', source: 'friend' });
    expect(ghostLabel(made({ source: 'friend', name: '' })).key).toBe('ghost.label.recording');
    expect(ghostLabel(botRun({ gameId: 'squat-flap', seed: 5, durationMs: 30_000, level: 'easy', at: AT }))).toMatchObject({ key: 'ghost.label.bot', name: '', source: 'bot' });
  });
});

describe('what is refused', () => {
  const ok = made();
  const problem = (over: Record<string, unknown>): string | null => { const r = checkRun({ ...ok, ...over }); return r.ok ? null : r.problem; };

  it('accepts a good one and rebuilds it field by field', () => {
    const r = checkRun({ ...ok, extra: 'ignored', score: 99999 });
    expect(r).toEqual({ ok: true, run: ok });
    expect(Object.keys((r as { run: GhostRun }).run).sort()).toEqual(['at', 'durationMs', 'gameId', 'name', 'outcomes', 'seed', 'source', 'v']);
  });

  it('says which field is wrong', () => {
    expect(checkRun(null)).toEqual({ ok: false, problem: 'shape' });
    expect(checkRun([])).toEqual({ ok: false, problem: 'shape' });
    expect(checkRun('x')).toEqual({ ok: false, problem: 'shape' });
    expect(problem({ v: 2 })).toBe('version');
    for (const g of ['', 'A', 'Squat Flap', 'x'.repeat(40), 5, null, '../etc']) expect(problem({ gameId: g }), String(g)).toBe('game');
    for (const s of [-1, 1.5, 2 ** 32, '5', null, Number.NaN]) expect(problem({ seed: s }), String(s)).toBe('seed');
    for (const d of [MIN_DURATION_MS - 1000, MAX_DURATION_MS + 1000, 45_500, '45000', null]) expect(problem({ durationMs: d }), String(d)).toBe('duration');
    for (const o of [ok.outcomes.slice(1), ok.outcomes + 'p', ok.outcomes.replace(/./, 'x'), 7, null]) expect(problem({ outcomes: o }), String(o)).toBe('outcomes');
    expect(problem({ source: 'cloud' })).toBe('source');
    expect(problem({ at: -1 })).toBe('time');
    expect(problem({ at: Number.POSITIVE_INFINITY })).toBe('time');
    expect(problem({ at: '1' })).toBe('time');
  });

  it('holds a name to the filter the Room holds names to, and a bot has none', () => {
    for (const n of ['visit www.example.com', 'call 555 123 4567', 'a'.repeat(30), 'x<y>', 5, null]) expect(problem({ name: n }), String(n)).toBe('name');
    expect(problem({ name: 'Çağrı Öz' })).toBeNull();
    expect(problem({ name: '' })).toBeNull();
    expect(problem({ source: 'bot', name: 'Ada' })).toBe('name');
    expect(problem({ source: 'bot', name: '' })).toBeNull();
  });

  it('drops a damaged skeleton and keeps the run', () => {
    const rec = new TrackRecorder(45_000);
    for (let i = 0; i < 200; i++) rec.push(i * 200, Array.from({ length: POSE_NUMBERS }, (_, k) => (i + k) % 250));
    const track = rec.finish() as string;
    expect(track).toBeTruthy();
    expect((checkRun({ ...ok, source: 'own', track }) as { run: GhostRun }).run.track).toBe(track);
    for (const bad of ['!!!', track.slice(0, 11), track + track, 5, '']) {
      const r = checkRun({ ...ok, source: 'own', track: bad });
      expect(r.ok, String(bad).slice(0, 12)).toBe(true);
      expect((r as { run: GhostRun }).run.track).toBeUndefined();
    }
  });
});

describe('the code to send', () => {
  const names = ['Ada', 'Çağrı Öz', 'Mert', '', 'Ayşe Nur', 'Jo'];

  it('is a short text that comes back as the same recording, whatever the game, the course, the length and the name', () => {
    let n = 0;
    for (const gameId of ['squat-flap', 'knee-sprint', 'star-catch']) {
      for (const durationMs of [MIN_DURATION_MS, 30_000, 45_000, 90_000, MAX_DURATION_MS]) {
        for (const seed of [0, 7, 123456789, 0xffff_ffff]) {
          const run = made({ gameId, durationMs, seed, name: names[n++ % names.length] as string, pass: (n % 9) + 1 });
          const code = encodeRun(run);
          expect(/^[A-Za-z0-9_-]+$/.test(code), code).toBe(true);
          expect(decodeRun(code), `${gameId} ${durationMs} ${seed}`).toEqual(run);
        }
      }
    }
  });

  it('is about fifty characters for a race of a minute, and never more than the longest race needs', () => {
    expect(encodeRun(made({ durationMs: 60_000, name: 'Ada' })).length).toBeLessThanOrEqual(64);
    expect(encodeRun(made({ durationMs: MAX_DURATION_MS, name: 'x'.repeat(20), gameId: 'knee-sprint' })).length).toBeLessThan(200);
  });

  it('comes back as a friend\'s recording, or as the kind it is told', () => {
    const own = made({ source: 'own', name: 'Me' });
    expect(decodeRun(encodeRun(own))?.source).toBe('friend');
    expect(decodeRun(encodeRun(own), 'own')?.source).toBe('own');
    expect(decodeRun(encodeRun(own), 'bot')?.source).toBe('friend');                // a code never says "bot"
  });

  it('carries no skeleton and no picture, only what the race was', () => {
    const rec = new TrackRecorder(45_000);
    for (let i = 0; i < 200; i++) rec.push(i * 200, Array.from({ length: POSE_NUMBERS }, () => 100));
    const withTrack = { ...made({ source: 'own' }), track: rec.finish() as string };
    expect(encodeRun(withTrack).length).toBe(encodeRun(made({ source: 'own' })).length);
    expect(decodeRun(encodeRun(withTrack), 'own')?.track).toBeUndefined();
  });

  it('refuses a typo, a cut link, a changed character, a made-up one and anything that is not text', () => {
    const run = made({ name: 'Ada' });
    const code = encodeRun(run);
    for (const bad of ['', ' ', 'x', 'hello world', code.slice(0, -1), code.slice(1), code + 'A', code.toLowerCase() === code ? code.toUpperCase() : code.toLowerCase(), code.replace(/./, '*'), 'A'.repeat(500), `${code}${code}`]) {
      expect(decodeRun(bad), bad.slice(0, 20)).toBeNull();
    }
    for (const bad of [null, undefined, 5, {}] as unknown[]) expect(decodeRun(bad as string)).toBeNull();
    // every character but the last (whose last bits are padding) is protected by the check sum
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (let i = 0; i < code.length - 1; i++) {
      const other = alphabet[(alphabet.indexOf(code[i] as string) + 1) % alphabet.length] as string;
      expect(decodeRun(code.slice(0, i) + other + code.slice(i + 1)), `change at ${i}`).toBeNull();
    }
    // a made-up code with a good check sum but outcomes that do not fit the course
    expect(decodeRun(encodeRun({ ...run, outcomes: 'pph' }))).toBeNull();
    // a name the filter refuses
    expect(decodeRun(encodeRun({ ...run, name: 'visit www.example.com' }))).toBeNull();
    // a recording of the wrong length of race
    expect(decodeRun(encodeRun({ ...run, durationMs: 200_000 }))).toBeNull();
  });
});

describe('the practice partner', () => {
  const o = { gameId: 'squat-flap', seed: 777, durationMs: 60_000, at: AT };

  it('is made from the seed alone, plays the same course as everybody, has no name and is labelled as a bot', () => {
    const a = botRun({ ...o, level: 'medium' });
    expect(botRun({ ...o, level: 'medium' })).toEqual(a);
    expect(a).toMatchObject({ source: 'bot', name: '', seed: 777, durationMs: 60_000 });
    expect(a.outcomes).toHaveLength(courseOf(o).length);
    expect(a.outcomes).not.toContain('.');
    expect(checkRun(a).ok).toBe(true);
    expect(decodeRun(encodeRun(a))?.source).toBe('friend');
    expect(botRun({ ...o, seed: 778, level: 'medium' }).outcomes).not.toBe(a.outcomes);
  });

  it('is harder at a higher level, as often as the level says, over many courses', () => {
    const avg = (level: 'easy' | 'medium' | 'hard'): { score: number; pass: number } => {
      let score = 0, passes = 0, all = 0;
      for (let seed = 1; seed <= 60; seed++) { const r = botRun({ ...o, seed, level }); score += runScore(r).score; passes += runScore(r).passes; all += r.outcomes.length; }
      return { score: score / 60, pass: passes / all };
    };
    const [e, m, h] = BOT_LEVELS.map(avg) as [ReturnType<typeof avg>, ReturnType<typeof avg>, ReturnType<typeof avg>];
    expect(e.score).toBeLessThan(m.score);
    expect(m.score).toBeLessThan(h.score);
    for (const [r, level] of [[e, 'easy'], [m, 'medium'], [h, 'hard']] as const) expect(Math.abs(r.pass - BOT_PASS[level])).toBeLessThan(0.1);
  });
});

describe('the skeleton of an own recording', () => {
  const pose = (k: number): number[] => Array.from({ length: POSE_NUMBERS }, (_, i) => (k * 3 + i) % 250);

  it('is kept five times a second, comes back at the moment it was seen and is missing where the body was not', () => {
    const rec = new TrackRecorder(30_000);
    for (let i = 0; i < 100; i++) if (i % 10 !== 5) rec.push(i * 200 + 17, pose(i));
    expect(rec.frames()).toBe(90);
    const track = rec.finish() as string;
    expect(trackPoseAt(track, 0)).toEqual(pose(0));
    expect(trackPoseAt(track, 3200 + 100)).toEqual(pose(16));
    expect(trackPoseAt(track, 1000 + 50)).toBeNull();                              // slot 5: no body
    expect(trackPoseAt(track, 1e9)).toEqual(trackPoseAt(track, 30_000));            // past the end: the last frame
    expect(trackPoseAt(track, -50)).toEqual(pose(0));
    expect(trackPoseAt(undefined, 100)).toBeNull();
    expect(trackPoseAt('%%%', 100)).toBeNull();
    expect(GHOST_HZ).toBe(5);
  });

  it('keeps the latest pose of a fifth of a second, ignores frames before the start and after the end, and bad ones', () => {
    const rec = new TrackRecorder(15_000);
    rec.push(10, pose(1));
    rec.push(150, pose(2));
    rec.push(-5, pose(3));
    rec.push(1e9, pose(4));
    rec.push(400, [1, 2, 3]);
    rec.push(600, null);
    expect(rec.frames()).toBe(1);
    for (let i = 0; i < 20; i++) rec.push(1000 + i * 200, pose(i));
    const track = rec.finish() as string;
    expect(trackPoseAt(track, 100)).toEqual(pose(2));
  });

  it('is not made at all from less than three seconds of body', () => {
    const rec = new TrackRecorder(15_000);
    for (let i = 0; i < GHOST_HZ * 3 - 1; i++) rec.push(i * 200, pose(i));
    expect(rec.finish()).toBeUndefined();
    rec.push(14_000, pose(1));
    expect(rec.finish()).toBeTruthy();
  });
});

describe('the words that say what a ghost is', () => {
  it('exist in English and Turkish for every label and the note, name the friend, and never call a bot a person', () => {
    for (const lang of ['en', 'tr'] as const) {
      const t = createI18n(lang, { onMissing: (k) => { throw new Error('missing ' + lang + ' ' + k); } });
      const own = t.t('ghost.label.own');
      const friend = t.t('ghost.label.friend', { name: 'Ada' });
      const recording = t.t('ghost.label.recording');
      const bot = t.t('ghost.label.bot');
      expect(friend).toContain('Ada');
      expect(bot.toLowerCase()).toContain('bot');
      expect(t.t('ghost.note.bot').toLowerCase()).toContain('bot');
      for (const s of [own, friend, recording, bot, t.t('ghost.note'), t.t('ghost.note.bot')]) {
        expect(s.length).toBeGreaterThan(5);
        expect(s).not.toMatch(/[—→←🌀-🫿]/u);           // no dash, arrow or emoji in interface text
        expect(s).not.toMatch(/{|}/);
      }
    }
  });
});
