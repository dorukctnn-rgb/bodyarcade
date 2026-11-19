import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REGION_IDS } from '../../core/ui/settings.ts';
import { loadCatalogue, repoRoot } from '../catalogue/load.ts';
import { coverBox, headBox, isHeroPose, placePops, POP_LIFE, type HeroPose, type Rect } from './hero-pose.ts';
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

  it('never puts a score pop on a face: clear of the head over its whole life, of the frame of the game, and inside the card', () => {
    // the display face is narrow: an uppercase letter or a figure is about half its size wide (0.56 here, a little more than it is)
    const measure = (text: string, size: number): number => text.length * size * 0.56;
    const text = ([, kind, n]: HeroPose['pops'][number]): string => (kind === 'pts' ? `+${n}` : kind === 'combo' ? `COMBO X${n}` : 'PERFECT');
    const hits = (a: Rect, b: Rect): boolean => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    const read = (f: string): HeroPose => JSON.parse(readFileSync(f, 'utf8')) as HeroPose;
    const heroFile = (f: string): string => join(repoRoot(), 'packages', 'web', 'src', 'hero-pose', f);
    // the cards with pops: the game tiles (with the frame of the game in their top right corner) and the tour's first page; the hero
    const cases: { name: string; pose: HeroPose; pw: number; ph: number; sizes: [number, number][]; inset: boolean; scale: number; minPx: number }[] = [
      ...[...new Set(Object.values(GAME_MOTION))].map((id) => ({ name: `${id} tile`, pose: read(clips(motionPoseFile(id, 'tile'))), pw: 640, ph: 480, sizes: [[315, 236], [358, 268], [630, 472]] as [number, number][], inset: true, scale: 0.5, minPx: 14 })),
      ...TOUR_MOTION[1].map((id) => ({ name: `${id} tall`, pose: read(clips(motionPoseFile(id, 'tall'))), pw: 720, ph: 900, sizes: [[390, 470], [780, 940], [720, 900], [600, 900]] as [number, number][], inset: false, scale: 0.8, minPx: 22 })),
      { name: 'hero wide', pose: read(heroFile('arena-wide-1280.json')), pw: 1280, ph: 720, sizes: [[1440, 900], [2880, 1800], [1024, 700]], inset: false, scale: 1, minPx: 26 },
      { name: 'hero tall', pose: read(heroFile('arena-tall-720.json')), pw: 720, ph: 900, sizes: [[390, 844], [780, 1688]], inset: false, scale: 1, minPx: 26 },
    ];
    // the hero and the tour's first page always score; a tile whose clip has no score moment shows none
    for (const c of cases.filter((x) => !x.name.endsWith(' tile'))) expect(c.pose.pops.length, c.name).toBeGreaterThan(0);
    for (const c of cases.filter((x) => x.pose.pops.length > 0)) {
      for (const [w, h] of c.sizes) {
        const box = coverBox(w, h, c.pw, c.ph);
        const dpr = w > 1000 && c.scale < 1 ? 2 : 1;
        const size = Math.max(c.minPx * dpr, Math.min(64 * dpr * c.scale, box.h * 0.14, w * 0.09));
        const avoid: Rect[] = c.inset ? [[w * 0.64 - 8 * dpr, 8 * dpr, w - 8 * dpr, 8 * dpr + (w * 0.36 * 3) / 4]] : [];
        const places = placePops(c.pose, { w, h, box, size, pad: 6 * dpr, measure, text, avoid });
        expect(places.filter(Boolean).length, `${c.name} ${w}x${h}: some pops fit`).toBeGreaterThan(0);
        places.forEach((p, i) => {
          if (!p) return;
          const at = c.pose.pops[i]![0];
          for (let k = 0; k <= 22; k += 1) {
            const age = k / 22;
            const half = measure(p.text, p.size) / 2, th = p.size * 0.9 / 2, y = p.y - p.rise * age;
            const r: Rect = [p.x - half, y - th, p.x + half, y + th];
            const where = `${c.name} ${w}x${h} pop ${i} at age ${age.toFixed(2)}`;
            expect(hits(r, headBox(c.pose, at + POP_LIFE * age, box)), `${where}: on the head`).toBe(false);
            for (const a of avoid) expect(hits(r, a), `${where}: under the frame of the game`).toBe(false);
            expect(r[0] >= 0 && r[1] >= 0 && r[2] <= w && r[3] <= h, `${where}: outside the card`).toBe(true);
          }
        });
      }
    }
  });
});
