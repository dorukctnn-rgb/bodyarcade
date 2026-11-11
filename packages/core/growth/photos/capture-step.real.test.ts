// The 360 mode on real people (the three Pexels turn clips of angle.real.test.ts, hand-labelled): the clips turn without
// stopping, so the step-by-step capture must not take a diagonal photo at all, and whatever it takes must be its direction.
// Measured 11 Nov 2026 (kol F): no diagonal photo on any clip; one front photo, 13 degrees off its direction.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseTrace, traceFrames } from '../../pose/trace.ts';
import { angleDiff, type Bucket } from './angle.ts';
import { Capture } from './capture.ts';
import { labelAt, type LabelSample } from './measure-lib.ts';

const dir = fileURLToPath(new URL('../../../../tests/traces/growth/', import.meta.url));
const labels = JSON.parse(readFileSync(`${dir}labels.json`, 'utf8')) as { clips: Record<string, { split: 'tune' | 'holdout'; samples: LabelSample[] }> };
const have = Object.keys(labels.clips).filter((id) => existsSync(`${dir}${id}.trace.json`));

describe('360 step by step on real turning people', () => {
  it('a turn that never stops takes no diagonal photo; every photo taken is within 22.5 degrees of its direction', () => {
    expect(have.length).toBe(3);
    let photos = 0;
    for (const id of have) {
      const cap = new Capture('full', { needFeet: false });
      const taken: { bucket: Bucket; deg: number }[] = [];
      for (const f of traceFrames(parseTrace(JSON.parse(readFileSync(`${dir}${id}.trace.json`, 'utf8'))))) {
        const s = cap.push({ t: f.t, lm: f.landmarks, aspect: f.aspect, sharp: 1 });
        if (s.justPending !== null) { taken.push({ bucket: s.justPending, deg: labelAt(labels.clips[id]!.samples, f.t) }); cap.accept(); }
      }
      expect(taken.filter((x) => x.bucket % 90 !== 0), id).toEqual([]);
      for (const x of taken) expect(angleDiff(x.deg, x.bucket), `${id} ${x.bucket}`).toBeLessThanOrEqual(22.5);
      photos += taken.length;
    }
    expect(photos).toBeLessThanOrEqual(3);
  });
});
