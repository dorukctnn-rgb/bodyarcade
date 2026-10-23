// The public surface keeps its names: games import these.
import { describe, expect, it } from 'vitest';
import * as kit from './index.ts';

describe('render2d public surface', () => {
  it('exports what games and the shell use', () => {
    for (const name of ['createScene2D', 'layoutScene', 'layoutDuo', 'layoutProblems', 'fitContain', 'makeProjector', 'BODY_STYLES', 'drawSkeleton', 'drawSilhouette', 'drawPip', 'createParticles', 'SpriteBank', 'drawSprite', 'domSurface']) {
      expect((kit as Record<string, unknown>)[name], name).toBeDefined();
    }
  });
});
