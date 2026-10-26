// Which features this device may offer. Two players in front of one camera (mode 'local2') needs a big screen and
// room in front of it: desktop, laptop, TV, or a tablet held in landscape. It is never offered inside the Android
// app (TWA) or on phone-sized screens in the browser (Doruk, 23 Oct). The two-person framing check still decides
// whether a game can start (TwoPlayerCalibrator).
import type { Capabilities, CapabilitiesFn, DeviceKind, DeviceSignals, Unsubscribe, WatchCapabilitiesFn } from '../types/index.ts';

/** The Play package of the Android app (android/twa-manifest.json on play/cloudflare-twa). */
export const ANDROID_PACKAGE = 'com.peakapps.bodyarcade';
const STORAGE_KEY = 'ba.androidApp';

/** Smallest side of a "big screen" in CSS px. Phones are under 600 (Android's own tablet line is 600 dp). */
export const MIN_SHORT_SIDE = 600;
/** TVs report odd pointers; a long side of 960 px or more is a big screen. */
export const MIN_TV_LONG_SIDE = 960;

const TV_UA = /\b(SMART-TV|SmartTV|Tizen|Web0S|webOS|BRAVIA|NetCast|AFT[A-Z]|CrKey|Android TV|GoogleTV|AppleTV|HbbTV|Roku)\b/i;
const PHONE_UA = /\b(iPhone|iPod|Windows Phone)\b|Android.+Mobile/i;

export function isAndroidApp(s: Pick<DeviceSignals, 'referrer' | 'search' | 'storedAndroidApp' | 'digitalGoods' | 'userAgent'>): boolean {
  if (s.storedAndroidApp) return true;
  if (s.referrer.startsWith(`android-app://${ANDROID_PACKAGE}`)) return true;
  if (/[?&](source|utm_source)=(twa|android-app)\b/i.test(s.search)) return true;
  // Play Billing's Digital Goods API is only there in a Trusted Web Activity.
  return s.digitalGoods && /Android/i.test(s.userAgent);
}

/** Pure decision from the signals (unit-tested). */
export const capabilitiesFrom: CapabilitiesFn = (s) => {
  const short = Math.min(s.screen.width, s.screen.height);
  const long = Math.max(s.screen.width, s.screen.height);
  const landscape = s.viewport.width >= s.viewport.height;
  const result = (device: DeviceKind, reason: Capabilities['local2Reason']): Capabilities => ({ device, local2: reason === 'ok', local2Reason: reason });

  if (isAndroidApp(s)) return result('android_app', 'android_app');
  if (TV_UA.test(s.userAgent)) return result('tv', long >= MIN_TV_LONG_SIDE ? 'ok' : 'small_screen');
  const touchFirst = s.pointer === 'coarse' || (s.pointer === 'none' && s.maxTouchPoints > 0);
  if (PHONE_UA.test(s.userAgent) || (touchFirst && short < MIN_SHORT_SIDE)) return result('phone', 'phone');
  if (touchFirst) return result('tablet', landscape ? 'ok' : 'tablet_portrait');
  if (s.pointer === 'none') return result('tv', long >= MIN_TV_LONG_SIDE ? 'ok' : 'small_screen');
  return result('desktop', short >= MIN_SHORT_SIDE ? 'ok' : 'small_screen');
};

type Win = Window & typeof globalThis & { getDigitalGoodsService?: unknown };

/** Reads the signals in a browser. Remembers an Android-app launch for later pages in the same tab. */
export function readDeviceSignals(w: Win = window as Win): DeviceSignals {
  const mm = (q: string): boolean => { try { return w.matchMedia(q).matches; } catch { return false; } };
  let stored = false;
  try { stored = w.sessionStorage.getItem(STORAGE_KEY) === '1'; } catch { /* storage blocked */ }
  const s: DeviceSignals = {
    userAgent: w.navigator.userAgent,
    referrer: w.document.referrer,
    search: w.location.search,
    storedAndroidApp: stored,
    digitalGoods: 'getDigitalGoodsService' in w,
    screen: { width: w.screen.width, height: w.screen.height },
    viewport: { width: w.innerWidth, height: w.innerHeight },
    pointer: mm('(pointer: fine)') ? 'fine' : mm('(pointer: coarse)') ? 'coarse' : 'none',
    anyFinePointer: mm('(any-pointer: fine)'),
    maxTouchPoints: w.navigator.maxTouchPoints ?? 0,
  };
  if (!stored && isAndroidApp(s)) { try { w.sessionStorage.setItem(STORAGE_KEY, '1'); } catch { /* storage blocked */ } }
  return s;
}

export function detectCapabilities(w?: Win): Capabilities {
  return capabilitiesFrom(readDeviceSignals(w));
}

/** Calls back now and whenever the answer changes (a tablet turned, a window moved to another screen). */
export const watchCapabilities: WatchCapabilitiesFn = (cb) => {
  const w = window as Win;
  let last = '';
  const check = (): void => {
    const c = detectCapabilities(w);
    const key = `${c.device}:${c.local2Reason}`;
    if (key !== last) { last = key; cb(c); }
  };
  check();
  const mq = w.matchMedia('(orientation: landscape)');
  w.addEventListener('resize', check);
  mq.addEventListener?.('change', check);
  const off: Unsubscribe = () => { w.removeEventListener('resize', check); mq.removeEventListener?.('change', check); };
  return off;
};
