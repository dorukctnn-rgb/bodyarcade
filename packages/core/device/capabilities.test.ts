// Two players, one camera: offered on desktop, laptop, TV and landscape tablets only (BUILD-PLAN).
import { describe, expect, it } from 'vitest';
import type { DeviceSignals } from '../types/index.ts';
import { ANDROID_PACKAGE, capabilitiesFrom } from './capabilities.ts';

const UA = {
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
  androidPhone: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 15; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
  tizenTv: 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 8.0) AppleWebKit/537.36 (KHTML, like Gecko) 120.0.0.0/8.0 TV Safari/537.36',
};

function signals(o: Partial<DeviceSignals>): DeviceSignals {
  return {
    userAgent: UA.windows, referrer: '', search: '', storedAndroidApp: false, digitalGoods: false,
    screen: { width: 1920, height: 1080 }, viewport: { width: 1600, height: 900 },
    pointer: 'fine', anyFinePointer: true, maxTouchPoints: 0, ...o,
  };
}

describe('capabilities: two players, one camera', () => {
  it.each([
    ['desktop', signals({})],
    ['laptop', signals({ userAgent: UA.mac, screen: { width: 1440, height: 900 }, viewport: { width: 1440, height: 820 } })],
    ['touch laptop', signals({ maxTouchPoints: 10, screen: { width: 1366, height: 768 } })],
    ['TV browser', signals({ userAgent: UA.tizenTv, pointer: 'none', screen: { width: 1920, height: 1080 } })],
    ['TV-sized screen with no pointer', signals({ pointer: 'none', anyFinePointer: false, screen: { width: 1280, height: 720 } })],
    ['tablet in landscape', signals({ userAgent: UA.androidTablet, pointer: 'coarse', anyFinePointer: false, maxTouchPoints: 10, screen: { width: 800, height: 1280 }, viewport: { width: 1280, height: 752 } })],
    ['iPad in landscape (desktop user agent)', signals({ userAgent: UA.ipad, pointer: 'coarse', anyFinePointer: false, maxTouchPoints: 5, screen: { width: 820, height: 1180 }, viewport: { width: 1180, height: 760 } })],
  ])('%s: offered', (_name, s) => {
    expect(capabilitiesFrom(s)).toMatchObject({ local2: true, local2Reason: 'ok' });
  });

  it('a tablet held upright: not now, offered once turned', () => {
    const portrait = signals({ userAgent: UA.androidTablet, pointer: 'coarse', maxTouchPoints: 10, screen: { width: 800, height: 1280 }, viewport: { width: 800, height: 1232 } });
    expect(capabilitiesFrom(portrait)).toEqual({ device: 'tablet', local2: false, local2Reason: 'tablet_portrait' });
  });

  it.each([
    ['Android phone', signals({ userAgent: UA.androidPhone, pointer: 'coarse', anyFinePointer: false, maxTouchPoints: 5, screen: { width: 412, height: 915 }, viewport: { width: 412, height: 800 } })],
    ['Android phone in landscape', signals({ userAgent: UA.androidPhone, pointer: 'coarse', maxTouchPoints: 5, screen: { width: 915, height: 412 }, viewport: { width: 915, height: 380 } })],
    ['iPhone', signals({ userAgent: UA.iphone, pointer: 'coarse', maxTouchPoints: 5, screen: { width: 390, height: 844 }, viewport: { width: 390, height: 750 } })],
    ['small touch screen, generic user agent', signals({ pointer: 'coarse', maxTouchPoints: 5, screen: { width: 360, height: 780 }, viewport: { width: 360, height: 700 } })],
  ])('%s: never offered', (_name, s) => {
    expect(capabilitiesFrom(s)).toEqual({ device: 'phone', local2: false, local2Reason: 'phone' });
  });

  it.each([
    ['launched by the app (referrer)', { referrer: `android-app://${ANDROID_PACKAGE}/` }],
    ['launch URL marker: the start address of the app, ?src=twa', { search: '?src=twa' }],
    ['launch URL marker (older spelling)', { search: '?source=twa' }],
    ['launch URL marker among other parameters', { search: '?lang=tr&src=twa&x=1' }],
    ['an earlier page saw the app', { storedAndroidApp: true }],
    ['Play Billing present on Android', { digitalGoods: true }],
  ])('inside the Android app (%s): never offered, even on a big tablet', (_name, extra) => {
    const tablet = signals({ userAgent: UA.androidTablet, pointer: 'coarse', maxTouchPoints: 10, screen: { width: 1600, height: 2560 }, viewport: { width: 2560, height: 1500 }, ...extra });
    expect(capabilitiesFrom(tablet)).toEqual({ device: 'android_app', local2: false, local2Reason: 'android_app' });
  });

  it('Play Billing on a desktop browser is not the Android app', () => {
    expect(capabilitiesFrom(signals({ digitalGoods: true })).local2).toBe(true);
  });

  it('a desktop with a tiny screen is not offered', () => {
    expect(capabilitiesFrom(signals({ screen: { width: 1024, height: 500 } }))).toEqual({ device: 'desktop', local2: false, local2Reason: 'small_screen' });
  });
});
