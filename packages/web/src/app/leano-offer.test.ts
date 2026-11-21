// Who gets the Leano card (app/leano-offer.ts): an iPhone, an iPod, an iPad (also one that presents itself as a Mac); nobody else, and
// nobody in the Android app. A pure decision from the device signals, so every case is a line of data.
import { describe, expect, it } from 'vitest';
import type { DeviceSignals } from '../../../core/types/index.ts';
import { isIosDevice, LEANO_APP_ID, leanoHref, leanoOffer } from './leano-offer.ts';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/137.0.7151.107 Mobile/15E148 Safari/604.1',
  ipod: 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  // iPadOS 13 and later asks for the desktop site by default
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  pixel: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
  galaxyTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  tv: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) 108.0.5359.1/7.0 TV Safari/537.36',
};

function signals(over: Partial<DeviceSignals>): DeviceSignals {
  return {
    userAgent: UA.windows, referrer: '', search: '', storedAndroidApp: false, digitalGoods: false,
    screen: { width: 1440, height: 900 }, viewport: { width: 1440, height: 900 }, pointer: 'fine', anyFinePointer: true, maxTouchPoints: 0, ...over,
  };
}
const phone = { screen: { width: 390, height: 844 }, viewport: { width: 390, height: 844 }, pointer: 'coarse' as const, anyFinePointer: false, maxTouchPoints: 5 };

describe('the iPhone and iPad check', () => {
  it.each([['iphone'], ['iphoneChrome'], ['ipod'], ['ipad']] as const)('says yes to %s', (k) => {
    expect(isIosDevice({ userAgent: UA[k], maxTouchPoints: 5 })).toBe(true);
    expect(isIosDevice({ userAgent: UA[k], maxTouchPoints: 0 })).toBe(true);
  });

  it('knows an iPad that presents itself as a Mac by its touch screen, and a Mac by having none', () => {
    expect(isIosDevice({ userAgent: UA.ipadDesktop, maxTouchPoints: 5 })).toBe(true);
    expect(isIosDevice({ userAgent: UA.mac, maxTouchPoints: 0 })).toBe(false);
    // a test browser with one emulated touch point is not an iPad
    expect(isIosDevice({ userAgent: UA.mac, maxTouchPoints: 1 })).toBe(false);
  });

  it.each([['pixel'], ['galaxyTablet'], ['windows'], ['linux'], ['tv']] as const)('says no to %s', (k) => {
    expect(isIosDevice({ userAgent: UA[k], maxTouchPoints: 5 })).toBe(false);
  });
});

describe('who gets the Leano card', () => {
  it('an iPhone and an iPad do', () => {
    expect(leanoOffer(signals({ ...phone, userAgent: UA.iphone }))).toBe(true);
    expect(leanoOffer(signals({ userAgent: UA.ipad, screen: { width: 820, height: 1180 }, viewport: { width: 820, height: 1180 }, pointer: 'coarse', maxTouchPoints: 5 }))).toBe(true);
    expect(leanoOffer(signals({ userAgent: UA.ipadDesktop, screen: { width: 1180, height: 820 }, viewport: { width: 1180, height: 820 }, pointer: 'coarse', maxTouchPoints: 5 }))).toBe(true);
  });

  it('an Android phone, a desktop, a laptop and a TV do not', () => {
    expect(leanoOffer(signals({ ...phone, userAgent: UA.pixel }))).toBe(false);
    expect(leanoOffer(signals({ userAgent: UA.galaxyTablet, pointer: 'coarse', maxTouchPoints: 5 }))).toBe(false);
    expect(leanoOffer(signals({ userAgent: UA.windows }))).toBe(false);
    expect(leanoOffer(signals({ userAgent: UA.mac }))).toBe(false);
    expect(leanoOffer(signals({ userAgent: UA.linux }))).toBe(false);
    expect(leanoOffer(signals({ userAgent: UA.tv, pointer: 'none', screen: { width: 1920, height: 1080 } }))).toBe(false);
  });

  it('the Android app (a Trusted Web Activity) never does, by any of the signs the site already reads', () => {
    // the Play app's own pages
    expect(leanoOffer(signals({ ...phone, userAgent: UA.pixel, referrer: 'android-app://com.peakapps.bodyarcade/' }))).toBe(false);
    expect(leanoOffer(signals({ ...phone, userAgent: UA.pixel, search: '?src=twa' }))).toBe(false);
    expect(leanoOffer(signals({ ...phone, userAgent: UA.pixel, storedAndroidApp: true }))).toBe(false);
    expect(leanoOffer(signals({ ...phone, userAgent: UA.pixel, digitalGoods: true }))).toBe(false);
    // and even a page that carries the app's marks under an Apple user agent (nothing like it exists; the card stays away)
    expect(leanoOffer(signals({ ...phone, userAgent: UA.iphone, referrer: 'android-app://com.peakapps.bodyarcade/' }))).toBe(false);
    expect(leanoOffer(signals({ ...phone, userAgent: UA.iphone, search: '?src=twa' }))).toBe(false);
    expect(leanoOffer(signals({ ...phone, userAgent: UA.iphone, storedAndroidApp: true }))).toBe(false);
  });

  it('an iPhone that came from another site or with a campaign still does', () => {
    expect(leanoOffer(signals({ ...phone, userAgent: UA.iphone, referrer: 'https://www.google.com/', search: '?utm_source=newsletter' }))).toBe(true);
  });
});

describe('the App Store link', () => {
  it('is Leano\'s own page with the place as the campaign and the media type of apps', () => {
    expect(LEANO_APP_ID).toBe('6761293700');
    expect(leanoHref('progress')).toBe('https://apps.apple.com/app/id6761293700?ct=bodyarcade-progress&mt=8');
    expect(leanoHref('results')).toBe('https://apps.apple.com/app/id6761293700?ct=bodyarcade-results&mt=8');
  });
});
