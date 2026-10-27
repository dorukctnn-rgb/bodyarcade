// What this device may offer. Mode 'local2' (two players, one camera) is for big screens only: desktop, laptop, TV,
// and tablets in landscape; never inside the Android app and never on phone-sized screens (Doruk, 23 Oct:
// "telefonda zor olur"). The two-person framing check (TwoPlayerCalibrator) still has to pass before a game starts.
import type { Unsubscribe } from './common.ts';

export type DeviceKind = 'desktop' | 'tv' | 'tablet' | 'phone' | 'android_app';

export interface Capabilities {
  device: DeviceKind;
  /** Offer "2 players, same camera". */
  local2: boolean;
  /** Why local2 is off; 'ok' when it is on. */
  local2Reason: 'ok' | 'android_app' | 'phone' | 'tablet_portrait' | 'small_screen';
}

/** Everything the decision is based on, so it is a pure, testable function of these values. */
export interface DeviceSignals {
  userAgent: string;
  /** document.referrer of the first page in this tab (a TWA launch sets android-app://<package>/). */
  referrer: string;
  /** location.search (the TWA start address is /?src=twa; source=twa is an older spelling). */
  search: string;
  /** An earlier page in this tab already found the Android app (sessionStorage). */
  storedAndroidApp: boolean;
  /** 'getDigitalGoodsService' in window: Play Billing in a Trusted Web Activity. */
  digitalGoods: boolean;
  /** Screen size in CSS pixels (the device, not the window). */
  screen: { width: number; height: number };
  /** Window size in CSS pixels (orientation of a tablet). */
  viewport: { width: number; height: number };
  /** Primary pointer from matchMedia('(pointer: ...)'). */
  pointer: 'fine' | 'coarse' | 'none';
  /** matchMedia('(any-pointer: fine)'): a mouse or trackpad is attached. */
  anyFinePointer: boolean;
  maxTouchPoints: number;
}

export type CapabilitiesFn = (s: DeviceSignals) => Capabilities;
export type WatchCapabilitiesFn = (cb: (c: Capabilities) => void) => Unsubscribe;
