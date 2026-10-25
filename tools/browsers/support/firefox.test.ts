import { afterEach, describe, expect, it } from 'vitest';
import { FIREFOX_PEERS, firefoxPrefs } from './firefox.ts';

describe('the Firefox preferences of the QA tools', () => {
  const before = process.env['BA_BROWSERS_NOWEBGL'];
  afterEach(() => { if (before === undefined) delete process.env['BA_BROWSERS_NOWEBGL']; else process.env['BA_BROWSERS_NOWEBGL'] = before; });

  it('give a fake camera, no prompt, and WebGL forced past the blocklist', () => {
    delete process.env['BA_BROWSERS_NOWEBGL'];
    expect(firefoxPrefs()).toMatchObject({ 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true, 'webgl.force-enabled': true, 'webgl.enable-webgl2': true });
    expect(firefoxPrefs()).not.toHaveProperty('webgl.disabled');
  });

  it('turn WebGL off for BA_BROWSERS_NOWEBGL, and keep the peer preferences when asked', () => {
    process.env['BA_BROWSERS_NOWEBGL'] = '1';
    const p = firefoxPrefs(FIREFOX_PEERS);
    expect(p).toMatchObject({ 'webgl.disabled': true, 'media.peerconnection.ice.loopback': true });
    expect(p).not.toHaveProperty('webgl.force-enabled');
  });
});
