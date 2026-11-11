// The form coach on REAL people: traces extracted from freely licensed videos (tools/form-fixtures, licences in SOURCES.md),
// hand-labelled (labels.json). The same numbers are printed by `node tools/form-fixtures/measure.ts` (SPEC.md section 12).
// Note: the thresholds were tuned on these same clips; held-out evidence needs new recordings (SPEC.md 7.3).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTrace } from '../pose/trace.ts';
import { fixtures, labels, loadTrace, runTrace, score } from '../../../tools/form-fixtures/run-lib.ts';
import { FAULTS } from '../../../tools/form-fixtures/faults.ts';
import { FORM_MOVE_IDS } from './moves/index.ts';

const lab = labels();
const all = fixtures().filter((f) => lab[f.id]);

describe('real video: repetitions and false alarms', () => {
  for (const f of all) {
    const l = lab[f.id]!;
    it(`${f.id}: ${l.kind === 'none' ? 'counts nothing' : l.kind === 'wrong' ? 'nothing it counts is clean' : `${l.reps?.length ?? 0} labelled repetitions`}`, () => {
      const r = runTrace(f.move, loadTrace(f.id));
      const s = score(r, l);
      if (l.kind === 'none') expect(s.counted).toBe(0);
      else if (l.kind === 'wrong') expect(s.caught).toBe(s.counted);
      else {
        expect(s.matched, 'every labelled repetition is counted').toBe(s.truth);
        // one extra count is allowed where a different movement looks like this one (52117: a step into a lunge)
        expect(s.counted - s.matched, 'extra counts').toBeLessThanOrEqual(f.id === 'sq-mixkit-52117-45' ? 1 : 0);
        expect(s.falseAlarm, `false alarms: ${JSON.stringify(s.alarmRules)}`).toBe(0);
        expect(s.caught, 'labelled wrong repetitions caught').toBe(s.wrong);
      }
      if (l.expectCue) expect([...r.cues]).toContain(l.expectCue);
    });
  }
});

describe('real video: a person standing still', () => {
  const still = parseTrace(JSON.parse(readFileSync(new URL('../../../tests/traces/video/army-standing-12s.trace.json', import.meta.url), 'utf8')));
  for (const move of FORM_MOVE_IDS) {
    it(`${move}: no repetition and no red part in 12 s`, () => {
      const r = runTrace(move, still);
      expect(r.reps).toHaveLength(0);
      expect(r.redFrames).toBe(0);
    });
  }
});

describe('real video at 15 poses a second (a slow phone)', () => {
  it('still counts every labelled repetition', () => {
    for (const f of all) {
      const trace = loadTrace(f.id);
      // at 15 poses a second the smoothing lags a little more: a repetition at the very end of a clip (its bottom in the last
      // 1.5 s) may only finish after the clip does (jl-mixkit-52316-45, 11 Nov 2026), so those are left out here
      const endS = (trace.frames.at(-1)?.t ?? 0) / 1000;
      const l0 = lab[f.id]!;
      const l = l0.reps ? { ...l0, reps: l0.reps.filter((r) => r.t < endS - 1.5) } : l0;
      const s = score(runTrace(f.move, trace, 15), l);
      expect(s.matched, f.id).toBe(s.truth);
    }
  });
});

describe('controlled faults on real traces (semi-synthetic)', () => {
  for (const c of FAULTS.filter((x) => x.expect !== 'below-threshold')) {
    it(`${c.fixture}: ${c.fault} -> ${c.rule}`, () => {
      const r = runTrace(c.move, c.make(loadTrace(c.fixture)));
      if (c.expect === 'not-counted') {
        expect(r.reps).toHaveLength(0);
        expect([...r.cues]).toContain(c.cue);
        return;
      }
      expect(r.reps.length).toBeGreaterThan(0);
      for (const rep of r.reps) expect([...rep.errors, ...rep.tips]).toContain(c.rule);
    });
  }
});
