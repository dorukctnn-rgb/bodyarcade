// The Leano card (views/leano.ts): a small cross-promotion of the sister app Leano (body measurements, App Store id 6761293700) for
// visitors on an iPhone or an iPad, and for nobody else. Whether this visitor gets it is decided here, in the browser, from the
// device alone; a page drawn without a visitor (the page generator, a crawler) never carries it, so the search pages stay what they were.
//
//   shown    an iPhone, an iPod or an iPad. An iPad that asks for desktop sites (iPadOS 13 and later, the default) says "Macintosh" in
//            its user agent; a Mac has no touch screen, so more than one touch point gives the iPad away.
//   never    the Android app (the Trusted Web Activity: android-app:// referrer, ?src=twa, the flag its first page leaves in the session,
//            Play Billing's Digital Goods API on Android; core/device/capabilities.ts isAndroidApp, the check every other part of the
//            site uses), any Android phone or tablet, a desktop, a laptop, a TV.
import { isAndroidApp } from '../../../core/device/capabilities.ts';
import type { DeviceSignals } from '../../../core/types/index.ts';

/** The App Store page of Leano (the id is the app's, apps.apple.com/app/id6761293700). */
export const LEANO_APP_ID = '6761293700';

/** The places the card is drawn in; the name goes into the link's campaign token, so the App Store analytics tell them apart. */
export type LeanoPlace = 'progress' | 'results';

/** The App Store link of a place: `ct` is the campaign (App Store Connect, App Analytics), `mt=8` the media type (apps). */
export const leanoHref = (place: LeanoPlace): string => `https://apps.apple.com/app/id${LEANO_APP_ID}?ct=bodyarcade-${place}&mt=8`;

/** An iPhone, an iPod or an iPad, also an iPad that presents itself as a Mac. */
export function isIosDevice(s: Pick<DeviceSignals, 'userAgent' | 'maxTouchPoints'>): boolean {
  const ua = s.userAgent;
  if (/Android/i.test(ua)) return false;
  if (/\b(iPhone|iPad|iPod)\b/.test(ua)) return true;
  return /\bMacintosh\b/.test(ua) && s.maxTouchPoints > 1;
}

/** Pure decision from the signals (unit-tested): an Apple device that is not the Android app's page. */
export function leanoOffer(s: DeviceSignals): boolean {
  return isIosDevice(s) && !isAndroidApp(s);
}
