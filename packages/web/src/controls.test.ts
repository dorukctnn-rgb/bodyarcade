// Playing without the camera: which games the shell offers swipes and taps for on a touch screen is a rule of the shell (a game's template:
// the mirror games have keys that move a cursor and no swipes), and the games themselves declare what they bind (`controls` of the module,
// bound by the session). This holds the rule to the games, so a game that gains swipes or loses them is noticed here.
import { describe, expect, it } from 'vitest';
import type { GameModule } from '../../core/types/index.ts';
import { touchPlays } from './views/setup.ts';

const files = import.meta.glob<{ default: GameModule }>('../../games/*/index.ts', { eager: true });

describe('the games that can be played without the camera', () => {
  // a folder of a shared kit (kit-g1) has an index and no game
  const modules = Object.entries(files).map(([path, file]) => ({ id: path.split('/').at(-2) ?? '', module: file.default })).filter((m) => m.module?.manifest);

  it('finds the games of this build', () => {
    expect(modules.length).toBeGreaterThanOrEqual(11);
    expect(modules.map((m) => m.id)).toContain('squat-flap');
    expect(modules.map((m) => m.id)).toContain('pad-work');
  });

  it('every game has keys, and has swipes exactly where the shell says a touch screen can play it', () => {
    const wrong: string[] = [];
    for (const { id, module } of modules) {
      const keys = module.controls?.keys ? Object.keys(module.controls.keys).length : 0;
      const swipes = module.controls?.touch ? Object.keys(module.controls.touch).length : 0;
      if (keys === 0) wrong.push(`${id} binds no keys`);
      if (touchPlays(module.manifest) !== swipes > 0) wrong.push(`${id} (${module.manifest.template}): the shell says touch is ${touchPlays(module.manifest) ? 'on' : 'off'}, the module binds ${swipes} swipes`);
    }
    expect(wrong, wrong.join('\n')).toEqual([]);
  });
});
