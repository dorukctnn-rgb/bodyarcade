import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../catalogue/load.ts';
import { CLIP_TILES, CLIP_TYPES, clipFiles, clipSet, clipShouldPlay, clipsAllowed, parseClipSet, pickClip, pickFormat } from './clips.ts';

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

  it('play on the screen only, after the page has loaded, in a tab in front; with a mouse only while hovered or focused', () => {
    const s = { ready: true, hidden: false, inView: true, hoverDevice: false, engaged: false, failed: false };
    expect(clipShouldPlay(s)).toBe(true);
    expect(clipShouldPlay({ ...s, ready: false })).toBe(false);
    expect(clipShouldPlay({ ...s, hidden: true })).toBe(false);
    expect(clipShouldPlay({ ...s, inView: false })).toBe(false);
    expect(clipShouldPlay({ ...s, failed: true })).toBe(false);
    expect(clipShouldPlay({ ...s, hoverDevice: true })).toBe(false);
    expect(clipShouldPlay({ ...s, hoverDevice: true, engaged: true })).toBe(true);
    expect(clipShouldPlay({ ...s, hoverDevice: true, engaged: true, inView: false })).toBe(false);
  });
});
