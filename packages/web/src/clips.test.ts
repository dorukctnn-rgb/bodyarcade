import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../catalogue/load.ts';
import { CLIP_TILES, CLIP_TYPES, HERO_CLIP_PHONE, HERO_CLIP_WIDE, HERO_SECONDS, clipFiles, clipSet, clipShouldPlay, clipsAllowed, heroClipFile, heroClipFiles, heroClipHeight, heroClipSet, nextSlide, parseClipSet, pickClip, pickFormat, reelShouldRun, slideProgress } from './clips.ts';
import { SHOWCASE } from './showcase.ts';

describe('moving game tiles', () => {
  it('are the tiles that show the redrawn games, each in two sizes and two formats, all of them in design/art/clips', async () => {
    const art = (await import(/* @vite-ignore */ pathToFileURL(join(repoRoot(), 'design', 'art', 'tile-ids.mjs')).href)) as { FRAME_TILES: string[] };
    expect([...CLIP_TILES].sort()).toEqual([...art.FRAME_TILES].sort());
    for (const f of clipFiles()) expect(existsSync(join(repoRoot(), 'design', 'art', 'clips', f)), f).toBe(true);
    expect(clipFiles(['road-run'])).toEqual(['road-run-400.webm', 'road-run-800.webm', 'road-run-400.mp4', 'road-run-800.mp4']);
    expect(clipFiles()).toHaveLength(CLIP_TILES.length * 4);
  });

  it('carry their files as a width list and read it back', () => {
    const set = clipSet('pose-wall', 'mp4', (f) => `/static/clips/${f}`);
    expect(set).toBe('/static/clips/pose-wall-400.mp4 400w, /static/clips/pose-wall-800.mp4 800w');
    expect(parseClipSet(set)).toEqual([{ url: '/static/clips/pose-wall-400.mp4', width: 400 }, { url: '/static/clips/pose-wall-800.mp4', width: 800 }]);
    expect(parseClipSet('')).toEqual([]);
    expect(parseClipSet('b.webm 800w, a.webm 400w, broken')).toEqual([{ url: 'a.webm', width: 400 }, { url: 'b.webm', width: 800 }]);
  });

  it('take the narrowest file that is wide enough for the tile on that screen, and never more than the 2x one', () => {
    const set = parseClipSet('s.webm 400w, l.webm 800w');
    expect(pickClip(set, 195, 2)).toBe('s.webm');    // a phone tile: 390 device pixels
    expect(pickClip(set, 300, 1)).toBe('s.webm');    // a wide screen, density 1
    expect(pickClip(set, 300, 2)).toBe('l.webm');
    expect(pickClip(set, 195, 3)).toBe('s.webm');    // a density of 3 counts as 2
    expect(pickClip(set, 420, 1)).toBe('s.webm');    // up to 10% enlarged
    expect(pickClip(set, 480, 2)).toBe('l.webm');    // wider than the widest: the widest
    expect(pickClip([], 300, 1)).toBeNull();
  });

  it('play AV1 where the browser can, else H.264, else not at all', () => {
    expect(pickFormat((t) => (t === CLIP_TYPES.webm ? 'probably' : 'maybe'))).toBe('webm');
    expect(pickFormat((t) => (t === CLIP_TYPES.mp4 ? 'maybe' : ''))).toBe('mp4');
    expect(pickFormat(() => '')).toBeNull();
  });

  it('stay still when motion is reduced, when data is saved or slow, and for crawlers and scripts unless a test asks', () => {
    const base = { reducedMotion: false, automated: false };
    expect(clipsAllowed(base)).toBe(true);
    expect(clipsAllowed({ ...base, connection: { effectiveType: '4g' } })).toBe(true);
    expect(clipsAllowed({ ...base, reducedMotion: true })).toBe(false);
    expect(clipsAllowed({ ...base, reducedMotion: true, forced: true })).toBe(false);
    expect(clipsAllowed({ ...base, connection: { saveData: true } })).toBe(false);
    expect(clipsAllowed({ ...base, connection: { effectiveType: '2g' } })).toBe(false);
    expect(clipsAllowed({ ...base, connection: { effectiveType: 'slow-2g' } })).toBe(false);
    expect(clipsAllowed({ ...base, automated: true })).toBe(false);
    expect(clipsAllowed({ ...base, automated: true, forced: true })).toBe(true);
  });

  it('play whenever on the screen, after the page has loaded, in a tab in front, with a mouse as on a touch screen', () => {
    const s = { ready: true, hidden: false, inView: true, failed: false };
    expect(clipShouldPlay(s)).toBe(true);
    expect(clipShouldPlay({ ...s, ready: false })).toBe(false);
    expect(clipShouldPlay({ ...s, hidden: true })).toBe(false);
    expect(clipShouldPlay({ ...s, inView: false })).toBe(false);
    expect(clipShouldPlay({ ...s, failed: true })).toBe(false);
  });
});

describe('moving pictures at the top of the home page', () => {
  const ids = SHOWCASE.map((x) => x.id);

  it('give each frame of the showcase a clip in the wide crop (two sizes) and the phone crop (one), in two formats, all of them in design/art/clips', () => {
    const files = heroClipFiles(ids);
    expect(files).toHaveLength(ids.length * 2 * (HERO_CLIP_WIDE.length + HERO_CLIP_PHONE.length));
    expect(new Set(files).size).toBe(files.length);
    for (const f of files) expect(existsSync(join(repoRoot(), 'design', 'art', 'clips', f)), f).toBe(true);
    expect(heroClipFile('alps', 'wide', 2000, 'webm')).toBe('hero-alps-2000.webm');
    expect(heroClipFile('alps', 'phone', 960, 'mp4')).toBe('hero-alps-m-960.mp4');
    // not mixed up with the tiles' files
    expect(files.some((f) => clipFiles().includes(f))).toBe(false);
  });

  it('are 21:9 in the wide crop and 4:3 in the phone crop, with even sizes', () => {
    expect(heroClipHeight('wide', 2000)).toBe(856);
    expect(heroClipHeight('wide', 1280)).toBe(548);
    expect(heroClipHeight('phone', 960)).toBe(720);
    for (const w of HERO_CLIP_WIDE) { expect(heroClipHeight('wide', w) % 2).toBe(0); expect(Math.abs(w / heroClipHeight('wide', w) - 21 / 9)).toBeLessThan(0.01); }
  });

  it('carry the files of a crop as a width list the player reads back, and pick the narrowest one that is sharp enough', () => {
    const set = heroClipSet('city', 'wide', 'webm', (f) => `/static/clips/${f}`);
    expect(set).toBe('/static/clips/hero-city-1280.webm 1280w, /static/clips/hero-city-2000.webm 2000w');
    const list = parseClipSet(set);
    expect(pickClip(list, 1030, 1)).toMatch(/1280\.webm$/);   // the card beside the week panel on a laptop
    expect(pickClip(list, 1240, 1)).toMatch(/1280\.webm$/);
    expect(pickClip(list, 1560, 1)).toMatch(/2000\.webm$/);   // the widest card on a screen of density 1
    expect(pickClip(list, 1030, 2)).toMatch(/2000\.webm$/);   // a dense screen gets the 2x file
    expect(pickClip(parseClipSet(heroClipSet('city', 'phone', 'mp4', (f) => f)), 359, 3)).toBe('hero-city-m-960.mp4');
  });

  it('go from slide to slide round and round', () => {
    expect([0, 1, 2, 3].map((i) => nextSlide(i, 4))).toEqual([1, 2, 3, 0]);
    expect(nextSlide(0, 0)).toBe(0);
    expect(HERO_SECONDS).toBe(5);
  });

  it('run on the screen only, after the page has loaded, in a tab in front', () => {
    const s = { ready: true, hidden: false, inView: true };
    expect(reelShouldRun(s)).toBe(true);
    expect(reelShouldRun({ ...s, ready: false })).toBe(false);
    expect(reelShouldRun({ ...s, hidden: true })).toBe(false);
    expect(reelShouldRun({ ...s, inView: false })).toBe(false);
  });

  it('change slides on the loop of the clip that plays, and by the page clock for a slide without one', () => {
    const base = { clipPlaying: true, clipTime: 0, clipLength: 5, wallMs: 0, slideMs: 5000 };
    expect(slideProgress(base)).toEqual({ fraction: 0, over: false });
    expect(slideProgress({ ...base, clipTime: 2.5, wallMs: 2600 })).toEqual({ fraction: 0.5, over: false });
    expect(slideProgress({ ...base, clipTime: 4.97, wallMs: 5000 }).over).toBe(true);
    // a clip of another length sets the length of its slide
    expect(slideProgress({ ...base, clipLength: 4, clipTime: 3.97, wallMs: 4000 }).over).toBe(true);
    expect(slideProgress({ ...base, clipLength: 4, clipTime: 3, wallMs: 3000 }).fraction).toBe(0.75);
    // no clip: the page's clock, five seconds
    const still = { ...base, clipPlaying: false, clipTime: 0 };
    expect(slideProgress({ ...still, wallMs: 2500 })).toEqual({ fraction: 0.5, over: false });
    expect(slideProgress({ ...still, wallMs: 4970 }).over).toBe(true);
    // a clip that stalls does not hold the slide for ever
    expect(slideProgress({ ...base, clipTime: 1, wallMs: 7001 }).over).toBe(true);
    expect(slideProgress({ ...base, clipTime: 1, wallMs: 6500 }).over).toBe(false);
    expect(slideProgress({ ...still, wallMs: 99999 }).fraction).toBe(1);
  });
});
