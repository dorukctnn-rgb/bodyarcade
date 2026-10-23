// The public surface keeps its names: games import these.
import { describe, expect, it } from 'vitest';
import * as kit from './index.ts';

describe('render3d public surface', () => {
  it('exports what games and the shell use', () => {
    for (const name of ['createScene3D', 'createQualityGovernor', 'initialQualityLevel', 'QUALITY_TIERS', 'tierFor', 'parseTheme', 'themeOrThrow', 'themeSignature', 'ResourceTracker', 'createPrototypeCache', 'createBatch', 'makeTexture', 'stripePixels', 'arrowPixels', 'fogCutDistance']) {
      expect((kit as Record<string, unknown>)[name], name).toBeDefined();
    }
  });
});
