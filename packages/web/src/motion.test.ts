import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REGION_IDS } from '../../core/ui/settings.ts';
import { loadCatalogue, repoRoot } from '../catalogue/load.ts';
import { isHeroPose } from './hero-pose.ts';
import {
  GAME_MOTION, MOTION_CLIPS, MOTION_SIZE, REGION_MOTION, TOUR_MOTION, COACH_MOTION, MATCH_MOTION, hasShape, motionAllowed, motionCap, motionClipFiles,
  motionPoseFile, motionPosterFiles, pickPlaying, tourClips, type MotionId, type MotionShape,
} from './motion.ts';

const clips = (f: string): string => join(repoRoot(), 'design', 'art', 'clips', f);
const hero = (f: string): string => join(repoRoot(), 'design', 'art', 'hero', f);

describe('the real people in motion', () => {
  it('has every file: the clip in two formats, its body line, and its poster in two formats, for each shape it is made in', () => {
    for (const f of motionClipFiles()) expect(existsSync(clips(f)), f).toBe(true);
    for (const f of motionPosterFiles()) expect(existsSync(hero(f)), f).toBe(true);
    expect(motionClipFiles()).toHaveLength(Object.values(MOTION_CLIPS).reduce((n, s) => n + s.length * 3, 0));
  });

  it('keeps every clip small: a tile under 400 KB, a tall one (the tour) under 700 KB, a poster under 60 KB', () => {
    for (const f of motionClipFiles().filter((x) => !x.endsWith('.json'))) {
      const max = f.includes('-tall.') ? 700_000 : 400_000;
      expect(statSync(clips(f)).size, f).toBeLessThan(max);
    }
    for (const f of motionPosterFiles()) expect(statSync(hero(f)).size, f).toBeLessThan(60_000);
  });

  it('has a body line for every frame of every clip, in the format the hero uses', () => {
    for (const [id, shapes] of Object.entries(MOTION_CLIPS) as [MotionId, readonly MotionShape[]][]) {
      for (const shape of shapes) {
        const p = JSON.parse(readFileSync(clips(motionPoseFile(id, shape)), 'utf8')) as unknown;
        expect(isHeroPose(p), `${id} ${shape}`).toBe(true);
        const pose = p as { n: number; fps: number; aspect: number };
        // 3 to 5 seconds (a climb and a squat play forward and back: up to 5.2)
        expect((pose.n - 1) / pose.fps, `${id} ${shape}`).toBeGreaterThan(2.9);
        expect((pose.n - 1) / pose.fps, `${id} ${shape}`).toBeLessThan(5.3);
        expect(pose.aspect, `${id} ${shape}`).toBeCloseTo(MOTION_SIZE[shape].w / MOTION_SIZE[shape].h, 2);
      }
    }
  });

  it('gives every game of the catalogue a person doing its move, and every body area a person working it', () => {
    const { catalogue } = loadCatalogue({ fixtures: 'none', requiredLangs: ['en'] });
    for (const g of catalogue.games) {
      expect(GAME_MOTION[g.id], g.id).toBeDefined();
      expect(hasShape(GAME_MOTION[g.id]!, 'tile'), g.id).toBe(true);
    }
    for (const r of REGION_IDS) expect(hasShape(REGION_MOTION[r], 'tile'), r).toBe(true);
    expect(hasShape(COACH_MOTION, 'tile')).toBe(true);
    expect(hasShape(MATCH_MOTION, 'tall')).toBe(true);
  });

  it('has a tall clip for every page of the tour and every area its third page offers', () => {
    for (const ids of Object.values(TOUR_MOTION)) for (const id of ids) expect(hasShape(id, 'tall'), id).toBe(true);
    for (const r of REGION_IDS.filter((x) => x !== 'seated')) expect(hasShape(tourClips(3, [r])[0]!, 'tall'), r).toBe(true);
    expect(tourClips(3, ['legs', 'arms'])).toEqual([REGION_MOTION.legs]);
    expect(tourClips(3, ['legs', 'arms'], 'arms')).toEqual([REGION_MOTION.arms]);
    expect(tourClips(3, [])).toEqual([REGION_MOTION.legs]);
    expect(tourClips(1, [])).toEqual(['squat', 'jacks', 'punch']);
  });

  it('plays at most two clips on a narrow screen and four on a wide one, the most visible first', () => {
    expect(motionCap(390)).toBe(2);
    expect(motionCap(1440)).toBe(4);
    const cards = [{ ratio: 0.4 }, { ratio: 1 }, { ratio: 0.1 }, { ratio: 1, failed: true }, { ratio: 0.9 }, { ratio: 0.5 }];
    expect([...pickPlaying(cards, 2)].sort()).toEqual([1, 4]);
    expect([...pickPlaying(cards, 4)].sort()).toEqual([0, 1, 4, 5]);
    expect(pickPlaying(cards, 0).size).toBe(0);
  });

  it('keeps the posters for reduced motion, saving data, 2G, a weak device, a crawler and a script', () => {
    const base = { reducedMotion: false, automated: false, weak: false };
    expect(motionAllowed(base)).toBe(true);
    expect(motionAllowed({ ...base, reducedMotion: true })).toBe(false);
    expect(motionAllowed({ ...base, connection: { saveData: true } })).toBe(false);
    expect(motionAllowed({ ...base, connection: { effectiveType: '2g' } })).toBe(false);
    expect(motionAllowed({ ...base, weak: true })).toBe(false);
    expect(motionAllowed({ ...base, automated: true })).toBe(false);
    expect(motionAllowed({ ...base, automated: true, forced: true })).toBe(true);
  });
});
