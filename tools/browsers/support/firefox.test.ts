import { afterEach, describe, expect, it } from 'vitest';
import { FIREFOX_PEERS, firefoxPrefs } from './firefox.ts';

describe('the Firefox preferences of the QA tools', () => {
  const before = process.env['BA_BROWSERS_NOWEBGL'];
  afterEach(() => { if (before === undefined) delete process.env['BA_BROWSERS_NOWEBGL']; else process.env['BA_BROWSERS_NOWEBGL'] = before; });

  it('give a fake camera and no prompt, and leave WebGL alone', () => {
    delete process.env['BA_BROWSERS_NOWEBGL'];
    expect(firefoxPrefs()).toMatchObject({ 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true });
    expect(firefoxPrefs()).not.toHaveProperty('webgl.disabled');
  });

  it('turn WebGL off for BA_BROWSERS_NOWEBGL, and keep the peer preferences when asked', () => {
    process.env['BA_BROWSERS_NOWEBGL'] = '1';
    const p = firefoxPrefs(FIREFOX_PEERS);
    expect(p).toMatchObject({ 'webgl.disabled': true, 'media.peerconnection.ice.loopback': true });
  });
});
