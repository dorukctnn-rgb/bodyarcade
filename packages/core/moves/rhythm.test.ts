// Beat windows and the beat grid (game-design.md card 25: Perfect 120 ms, Good 220 ms).
import { describe, expect, it } from 'vitest';
import { BEAT_WINDOWS, beatTimes, bpmOf, gradeOffset, gridFromBpm, judgeOnGrid, onBeatShare } from './rhythm.ts';

describe('grading an offset', () => {
  it('Perfect within 120 ms either side, Good within 220 ms, otherwise a miss', () => {
    expect(BEAT_WINDOWS).toEqual({ perfect: 120, good: 220 });
    expect(gradeOffset(0)).toBe('perfect');
    expect(gradeOffset(120)).toBe('perfect');
    expect(gradeOffset(-120)).toBe('perfect');
    expect(gradeOffset(121)).toBe('good');
    expect(gradeOffset(-220)).toBe('good');
    expect(gradeOffset(221)).toBe('miss');
    expect(gradeOffset(-400)).toBe('miss');
  });

  it('a game may pass its own windows (an easier level)', () => {
    expect(gradeOffset(150, { perfect: 160, good: 300 })).toBe('perfect');
    expect(gradeOffset(250, { perfect: 160, good: 300 })).toBe('good');
  });
});

describe('the beat grid', () => {
  it('120 per minute is a beat every 500 ms and back', () => {
    const g = gridFromBpm(120, 1000);
    expect(g.periodMs).toBe(500);
    expect(g.firstMs).toBe(1000);
    expect(bpmOf(g)).toBe(120);
  });

  it('a beat can be listed in any window', () => {
    const g = gridFromBpm(60, 500);
    expect(beatTimes(g, 0, 3000)).toEqual([500, 1500, 2500]);
    expect(beatTimes(g, 1500, 2500)).toEqual([1500]);
    expect(beatTimes(g, 3000, 3100)).toEqual([]);
  });

  it('judges against the nearest beat and says early or late', () => {
    const g = gridFromBpm(60, 0);
    const late = judgeOnGrid(2060, g);
    expect(late).toEqual({ grade: 'perfect', beat: 2, offsetMs: 60 });
    const early = judgeOnGrid(2800, g);
    expect(early.beat).toBe(3);
    expect(early.offsetMs).toBe(-200);
    expect(early.grade).toBe('good');
    expect(judgeOnGrid(1500, g).grade).toBe('miss');
  });

  it('takes the measured latency off first', () => {
    const g = gridFromBpm(60, 0);
    expect(judgeOnGrid(2200, g).grade).toBe('good');
    const j = judgeOnGrid(2200, g, 180);
    expect(j.grade).toBe('perfect');
    expect(j.offsetMs).toBe(20);
  });

  it('never picks a beat before the first or after the last', () => {
    const g = gridFromBpm(60, 1000);
    expect(judgeOnGrid(100, g).beat).toBe(0);
    expect(judgeOnGrid(9000, g, 0, BEAT_WINDOWS, 4).beat).toBe(4);
  });
});

describe('the share on the beat', () => {
  it('counts Perfect and Good, and is 0 with no events', () => {
    expect(onBeatShare([])).toBe(0);
    expect(onBeatShare(['perfect', 'good', 'miss', 'perfect'])).toBe(0.75);
  });
});
