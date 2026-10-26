// The TypeScript glyphs must draw exactly what the art director's reference draws.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { glyph, GROUPS, POSES, REGION_GLYPHS, type PoseName } from './glyphs.ts';

type Ref = {
  POSES: Record<string, unknown>;
  GROUPS: Record<string, string[]>;
  REGIONS: { id: string; pose: string; highlight: string[] }[];
  glyph(name: string, opts?: Record<string, unknown>): string;
};
const ref = (await import(/* @vite-ignore */ pathToFileURL(resolve(__dirname, '../../../design/brand/glyphs.mjs')).href)) as Ref;

describe('glyphs port', () => {
  it('has the same poses and groups', () => {
    expect(Object.keys(POSES).sort()).toEqual(Object.keys(ref.POSES).sort());
    for (const k of Object.keys(ref.GROUPS)) expect([...GROUPS[k as keyof typeof GROUPS]]).toEqual(ref.GROUPS[k]);
  });

  it('draws every pose like the reference, plain and highlighted', () => {
    for (const name of Object.keys(ref.POSES) as PoseName[]) {
      expect(glyph(name).toString()).toBe(ref.glyph(name));
      expect(glyph(name, { highlight: GROUPS.legs, accent: '#FF4F6E', size: 34, title: 'Legs' }).toString())
        .toBe(ref.glyph(name, { highlight: GROUPS.legs, accent: '#FF4F6E', size: 34, title: 'Legs' }));
    }
  });

  it('region glyphs follow the reference REGIONS (the seated and balance ids are renamed on purpose)', () => {
    const byId = new Map(ref.REGIONS.map((r) => [r.id, r]));
    for (const [id, g] of Object.entries(REGION_GLYPHS)) {
      const refId = id === 'mobility' ? 'balance' : id;
      const r = byId.get(refId);
      expect(r, id).toBeDefined();
      expect(g.pose).toBe(r?.pose);
      expect([...g.highlight]).toEqual(r?.highlight);
    }
  });

  it('decorative glyphs are hidden from screen readers and escape titles', () => {
    expect(glyph('squat', { decorative: true }).toString()).toContain('aria-hidden="true"');
    expect(glyph('squat', { decorative: true }).toString()).not.toContain('<title>');
    expect(glyph('squat', { title: '"><script>' }).toString()).not.toContain('<script>');
  });
});
