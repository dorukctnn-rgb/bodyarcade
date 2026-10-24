// What the legal and content pages state as fact, in one place: names, dates, prices, limits and how long each kind of data
// is kept. The pages write these numbers into their text (copy/*.ts), and content.test.ts compares every one of them with the
// constant of the code that does the thing (the plans, the sweep of the social server, the Room's timing, the chat filter,
// the age rules), so a number that changes in the code fails a test here until the page is read again and says the same.
//
// This file has no imports on purpose: the generator (build.ts) must run with nothing but Node, in the release build too.
// A change to a number here is a change to a legal text: read the page that uses it before you commit.

/** The one origin the pages name (canonical links, hreflang, the sitemap). */
export const SITE = 'https://bodyarcade.com';
export const EMAIL = 'info@peakappsstudio.com';
export const COMPANY = 'Peak Apps Studio';

/** When the privacy policy and the terms were last changed in substance (ISO day). Change it with the text. */
export const UPDATED = '2026-10-24';

/** Web list prices in US dollars (core/entitlements/plans.ts). On Google Play the price and the currency are Google Play's. */
export const PRICE = {
  proMonthly: 7.99,
  proYearly: 39.99,
  familyYearly: 59.99,
  lifetime: 119.99,
  /** What the earlier monthly members pay and keep paying. */
  legacyMonthly: 4.99,
  /** What the earlier lifetime buyers paid: they are Founders. */
  founder: 99,
} as const;

export const TRIAL_DAYS = 7;
/** The reminder before a trial ends, in days. */
export const REMINDER_DAYS = 2;
/** Devices one purchase may be active on at the same time. */
export const DEVICES = { pro: 3, family: 4, founder: 6 } as const;
/** Profiles on one device with the Family plan (and for Founders). */
export const FAMILY_PROFILES = 6;

/**
 * Does a relay server (Cloudflare TURN) carry friend video when two devices cannot connect directly? It does only once the two TURN
 * secrets are in the Worker (release/secrets.ts: TURN_KEY_ID and TURN_KEY_API_TOKEN). The product ships without them for now, so the
 * pages say that no picture is shown then. Set this to true on the day the secrets go in.
 */
export const RELAY_ON = false;

/** Does the Family plan exist for sale? It is only described while the profiles on one device are built (see the notes). */
export const FAMILY_PLAN = true;

// ───────── Pro licences (the licence service) ─────────
/** The longest a licence handed to a device lasts, in days. */
export const LICENCE_DAYS = 7;
/** How often the app asks again, in hours. */
export const RENEW_HOURS = 24;
/** A device that did not use a purchase for this long gives its place back, in days. */
export const SEAT_IDLE_DAYS = 90;
/** A purchase that ended and has no device left is forgotten after this many days. */
export const FORGET_PURCHASE_DAYS = 180;
/** How long a check made directly with Gumroad is good without a network, in days. */
export const DIRECT_GRACE_DAYS = 30;
/** Failed deliveries of the reminder e-mail before the address is dropped. */
export const REMINDER_TRIES = 5;

// ───────── live play (rooms) ─────────
export const SEATS = { min: 2, max: 4 } as const;
/** A room nobody is in disappears after this many minutes. */
export const ROOM_EMPTY_MINUTES = 10;
/** Any room disappears this many hours after its last activity. */
export const ROOM_IDLE_HOURS = 24;
/** Chat lines a room keeps (and hands to a report). */
export const CHAT_KEEP_LINES = 50;
export const CHAT_MAX_CHARS = 200;
export const CHAT_GAP_SECONDS = 5;
export const NAME_MAX_CHARS = 20;
/** Different players who report one player in a room before that player's free text is muted, and for how many hours. */
export const REPORTS_TO_MUTE = 3;
export const MUTE_HOURS = 24;
/** Different reporters within 7 days who close public lobbies to a player for 3 days, pending review. */
export const REPORTS_TO_SUSPEND = 6;
export const SUSPEND_DAYS = 3;
/** Body points the pose model finds, and the joints a friend sees of you in a race. */
export const MODEL_POINTS = 33;
export const SHARED_JOINTS = 13;

// ───────── the online profile (the social server) ─────────
/** A profile nobody has used for this many days is erased. */
export const UNUSED_PROFILE_DAYS = 400;
/** An unanswered friend request disappears after this many days; a declined one keeps its sender out for this many. */
export const REQUEST_DAYS = 30;
export const DECLINE_DAYS = 7;
/** A player counts as offline after this many minutes without a signal. */
export const PRESENCE_MINUTES = 9;
/** A room that stops reporting is hidden from the lobby list after this many minutes and removed after this many hours. */
export const LOBBY_HIDE_MINUTES = 15;
export const LOBBY_GONE_HOURS = 6;
/** Weekly boards keep this week and the one before. */
export const BOARD_WEEKS = 2;
/** Reports: how long a handled one is kept, and one about a profile that no longer exists. */
export const RESOLVED_REPORT_DAYS = 90;
export const ORPHAN_REPORT_DAYS = 30;
/** The moderation log. */
export const AUDIT_DAYS = 365;
/** Devices one profile may hold at the same time (the oldest goes when a sixth is added). */
export const PROFILE_DEVICES = 5;
export const MAX_FRIENDS = { teen: 50, adult: 100 } as const;
/** The age lines. */
export const AGE = { online: 13, video: 18 } as const;

export type Lang = 'en' | 'tr';

/** A price the way a person of that language writes it: "$7.99" and "$7,99". */
export function usd(amount: number, lang: Lang): string {
  const fixed = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return `$${lang === 'tr' ? fixed.replace('.', ',') : fixed}`;
}

/** An ISO day written for a page: "24 October 2026", "24 Ekim 2026". */
export function longDate(iso: string, lang: Lang): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const months = lang === 'tr'
    ? ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']
    : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${d} ${months[m - 1] ?? ''} ${y}`;
}
