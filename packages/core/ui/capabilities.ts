// What this device and this build can offer. The platform builder adds the official Capabilities flag to the
// contract (BUILD-PLAN "Two players, one camera"); until it lands this module carries the same rule, in one
// pure function with its own tests, so swapping the real flag in is a one-line change.
import { deviceClass, type DeviceClass } from './layout.ts';

export type Platform = 'web' | 'android-app';

export interface CapabilityEnv {
  viewport: { w: number; h: number };
  platform: Platform;
  touch: boolean;
  /** navigator.mediaDevices.getUserMedia exists. */
  camera: boolean;
  /** https or localhost; the camera needs it (B8 showed the wrong message for this). */
  secure: boolean;
  /** The user agent says TV, or the player picked "I play on a TV". */
  tv: boolean;
}

export interface Capabilities {
  platform: Platform;
  deviceClass: DeviceClass;
  landscape: boolean;
  touch: boolean;
  camera: boolean;
  secure: boolean;
  tv: boolean;
  /** Two players in front of one camera (web only, big screens; hidden on phones and in the Android app). */
  local2: boolean;
}

/**
 * Doruk, 23 Oct: web only, big screens (desktop, laptop, TV, a tablet in landscape), hidden inside the Android app
 * and on phone-sized screens in the browser ("telefonda zor olur"). A tablet that passes this still has to pass the
 * two-person framing check before a round starts.
 */
export function local2Available(env: Pick<CapabilityEnv, 'viewport' | 'platform'>): boolean {
  if (env.platform !== 'web') return false;
  const { w, h } = env.viewport;
  if (deviceClass(w, h) === 'phone') return false;
  return w > h;
}

export function capabilitiesFrom(env: CapabilityEnv): Capabilities {
  const { w, h } = env.viewport;
  return {
    platform: env.platform,
    deviceClass: deviceClass(w, h),
    landscape: w > h,
    touch: env.touch,
    camera: env.camera,
    secure: env.secure,
    tv: env.tv,
    local2: local2Available(env),
  };
}

/** Reads the browser. Only called in the browser; the page generator never needs it. */
export function detectCapabilities(win: Window & typeof globalThis): Capabilities {
  const nav = win.navigator;
  const twa = win.document.referrer.startsWith('android-app://') || new URLSearchParams(win.location.search).get('source') === 'twa';
  const ua = nav.userAgent || '';
  return capabilitiesFrom({
    viewport: { w: win.innerWidth, h: win.innerHeight },
    platform: twa ? 'android-app' : 'web',
    touch: 'ontouchstart' in win || nav.maxTouchPoints > 0,
    camera: !!nav.mediaDevices?.getUserMedia,
    secure: win.isSecureContext,
    tv: /smart-?tv|googletv|android tv|aftb|crkey|tizen|web0s|hbbtv/i.test(ua),
  });
}
