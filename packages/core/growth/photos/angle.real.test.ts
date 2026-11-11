// G2 on real people: landmark traces of freely licensed turn-in-place clips (Pexels, tools/growth-fixtures/SOURCES.md),
// hand-labelled every 0.5 s. The thresholds were tuned on the tuning clip only; the holdout clips are scored here.
// The numbers asserted are the measured ones (11 Nov 2026); SPEC 2.5's target is in the notes and in SOURCES.md.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseTrace } from '../../pose/trace.ts';
import { photoScore, score, type LabelSample } from './measure-lib.ts';

const dir = fileURLToPath(new URL('../../../../tests/traces/growth/', import.meta.url));
const labels = JSON.parse(readFileSync(`${dir}labels.json`, 'utf8')) as { clips: Record<string, { split: 'tune' | 'holdout'; samples: LabelSample[] }> };
const have = Object.keys(labels.clips).filter((id) => existsSync(`${dir}${id}.trace.json`));

// The traces were extracted with tools/growth-fixtures/extract.ts (one headless browser) on 11 Nov 2026 and are in the
// repository, so this block always runs.
describe('turn tracker on real turning people', () => {
  it('has the three fixture traces', () => { expect(have.length).toBe(3); });
  for (const split of ['tune', 'holdout'] as const) {
    it(`${split} clips: main directions and the 360 steps`, () => {
      let mainN = 0, mainR = 0, fullN = 0, far = 0;
      for (const id of have.filter((x) => labels.clips[x]!.split === split)) {
        const s = score(parseTrace(JSON.parse(readFileSync(`${dir}${id}.trace.json`, 'utf8'))), labels.clips[id]!.samples);
        mainN += s.main.n; mainR += s.main.right; fullN += s.full.n; far += s.full.far;
      }
      const main = mainR / mainN, farShare = far / fullN;
      console.log(`${split}: main ${mainR}/${mainN} = ${(main * 100).toFixed(1)} %, two or more steps off ${far}/${fullN}`);
      expect(mainN).toBeGreaterThan(10);
      expect(main).toBeGreaterThanOrEqual(MEASURED[split].main);
      expect(farShare).toBeLessThanOrEqual(MEASURED[split].far);
    });
    it(`${split} clips: the photo each direction would keep is that direction`, () => {
      for (const mode of ['quick', 'full'] as const) {
        let wanted = 0, right = 0;
        for (const id of have.filter((x) => labels.clips[x]!.split === split)) {
          const p = photoScore(parseTrace(JSON.parse(readFileSync(`${dir}${id}.trace.json`, 'utf8'))), labels.clips[id]!.samples, mode);
          wanted += p.wanted; right += p.right;
        }
        console.log(`${split} ${mode} photos: ${right}/${wanted} within 22.5 degrees`);
        expect(right / wanted).toBeGreaterThanOrEqual(MEASURED[split].photos[mode]);
      }
    });
  }
});

/**
 * The measured floors (11 Nov 2026, tools/growth-fixtures/measure.ts); the test fails if the tracker gets worse.
 * Frame by frame (every high-confidence label): tune main 10/16, two or more steps off 4/18; holdout main 31/41, two or more
 * steps off 4/54. Below SPEC 2.5's target (main >= 95 %, two steps off 0 %): from behind, in loose shirts, the pose model reads
 * the shoulders narrow, so the side-to-back and side-to-front changes come about half a second late.
 * The photos (the frame each direction would keep): quick mode 4/4 tune and 8/8 holdout; 360 mode 6/8 tune and 13/16 holdout
 * (the misses are diagonals: a 135 photo that is nearly the back, 45 photos about 25 degrees off).
 */
const MEASURED = {
  tune: { main: 10 / 16, far: 4 / 18, photos: { quick: 1, full: 6 / 8 } },
  holdout: { main: 31 / 41, far: 4 / 54, photos: { quick: 1, full: 13 / 16 } },
};
