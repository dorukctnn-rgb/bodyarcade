// The CPU twin of the final pass: the sky and fog colours that the direct path drew raw come out the same through it.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_GRADE, displayOf, sceneForDisplay } from './post.ts';
import { lookOf } from './looks.ts';
import worlds from './themes/classic-worlds.json' with { type: 'json' };

describe('post: the final tone map and its inverse', () => {
  it('maps black to black and bright light below 1', () => {
    expect(displayOf([0, 0, 0], 1.05).every((v) => v === 0)).toBe(true);
    expect(displayOf([8, 8, 8], 1.05).every((v) => v <= 1)).toBe(true);
  });

  it('finds, for every sky and fog colour of the ten worlds, the scene colour that shows as it did', () => {
    for (const w of worlds as { sky: { top: string; mid: string; bot: string }; fog: { color: string }; exposure?: number }[]) {
      for (const hex of [w.sky.top, w.sky.mid, w.sky.bot, w.fog.color]) {
        const c = new THREE.Color(hex);
        const x = sceneForDisplay([c.r, c.g, c.b], w.exposure ?? 1.05);
        const back = displayOf(x, w.exposure ?? 1.05);
        // ACES cannot show the last trace of red in a deep blue sky (0.03 at most); green and blue match.
        expect(Math.abs(back[0] - c.r)).toBeLessThan(0.03);
        expect(Math.abs(back[1] - c.g)).toBeLessThan(0.002);
        expect(Math.abs(back[2] - c.b)).toBeLessThan(0.002);
      }
    }
  });

  it('grades every world with values in range', () => {
    for (const w of worlds as { id: string }[]) {
      const g = { ...DEFAULT_GRADE, ...lookOf(w.id).grade };
      expect(g.contrast).toBeGreaterThan(0.8);
      expect(g.contrast).toBeLessThan(1.3);
      expect(g.vignette).toBeLessThan(0.5);
      expect(g.bloom).toBeLessThan(1);
    }
  });
});
