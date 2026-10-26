// Browser defaults: one camera and one pose service per page, shared by every session; overrides win.
import { describe, expect, it } from 'vitest';
import { browserServices, createBrowserSession } from './browser.ts';

describe('browser session defaults', () => {
  it('every session of the page shares one camera and one pose service', () => {
    const a = browserServices();
    expect(browserServices()).toBe(a);
    expect(browserServices().pose).toBe(a.pose);
  });

  it('makes an idle session; options override the defaults', async () => {
    const s = createBrowserSession({
      games: () => null,
      ui: () => { throw new Error('not reached'); },
      doc: Object.assign(new EventTarget(), { hidden: false }),
      wakeLock: null,
    });
    expect(s.state).toBe('idle');
    const errors: string[] = [];
    s.on('error', (e) => errors.push(e.code));
    await s.start('nope', { mode: 'solo', difficulty: 'normal', input: 'keyboard', seated: false });
    expect(errors).toEqual(['game_not_found']);
  });
});
