// Which delegate the pose model is created on: the GPU only where it is known to keep up (QA 25 Oct: Firefox stalled on it).
import { describe, expect, it } from 'vitest';
import { gpuDelegateWorthTrying } from './landmarker.ts';

const UA = {
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Safari/605.1.15',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
  firefoxIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/150.0 Mobile/15E148 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36',
  firefoxWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:157.0) Gecko/20100101 Firefox/157.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0',
  firefoxAndroid: 'Mozilla/5.0 (Android 15; Mobile; rv:157.0) Gecko/157.0 Firefox/157.0',
};

describe('gpuDelegateWorthTrying', () => {
  it('a real GPU in Chromium, Edge, Safari, iPhone (any browser there is WebKit) and Android Chrome: the GPU is tried first', () => {
    for (const ua of [UA.chromeWin, UA.edge, UA.safariMac, UA.iphone, UA.firefoxIos, UA.androidChrome]) {
      expect(gpuDelegateWorthTrying('hardware', ua), ua).toBe(true);
    }
  });

  it('Firefox on every system plays on the CPU: it masks the renderer and its GPU delegate stalled the round (QA 25 Oct)', () => {
    for (const ua of [UA.firefoxWin, UA.firefoxMac, UA.firefoxLinux, UA.firefoxAndroid]) {
      expect(gpuDelegateWorthTrying('hardware', ua), ua).toBe(false);
    }
  });

  it('a software renderer or no WebGL2 at all plays on the CPU, whatever the browser (B7)', () => {
    for (const ua of [UA.chromeWin, UA.safariMac, UA.firefoxWin, '']) {
      expect(gpuDelegateWorthTrying('software', ua)).toBe(false);
      expect(gpuDelegateWorthTrying('none', ua)).toBe(false);
    }
  });

  it('a realm with no user agent (a test runner) keeps the GPU on real hardware', () => {
    expect(gpuDelegateWorthTrying('hardware', '')).toBe(true);
  });
});
