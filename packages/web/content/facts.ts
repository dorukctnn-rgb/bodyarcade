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

/**
 * Who makes BodyArcade and is the data controller (Doruk's decision of 25 Oct 2026): a private person, no company. "Peak Apps Studio" is the
 * name he trades under (the brand on the store pages), not a legal entity, so no page calls it a company. No street address is published;
 * the e-mail address is the way to reach him, data requests included.
 */
export const OWNER = 'Doruk Çetin';
export const STUDIO = 'Peak Apps Studio';
export const COUNTRY = 'Türkiye';

/** When the privacy policy and the terms were last changed in substance (ISO day). Change it with the text. */
export const UPDATED = '2026-10-26';

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

/** The refund period of the plans sold on the web, in days (Gumroad's refund policy of each of the four products must say the same). */
export const REFUND_DAYS = 14;
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

/**
 * Does the web send the one trial-reminder e-mail? Only once ENT_MAIL_TOKEN and ENT_MAIL_FROM are in the production Worker
 * (release/secrets.ts); without them the server reports `reminders: false`, the Pro screen offers no address box and the server keeps
 * no address. While this is false the pages promise only the notice in the app (and Google Play's own reminder). Set it to true in the
 * release whose deploy carries both secrets (the launch kit verify-launch.mjs reports the server's `reminders` after a deploy).
 */
export const REMINDER_MAIL = false;

/**
 * Does the Family plan exist for sale? True: its Gumroad product exists (core/entitlements/catalog.ts). The shell hides it from the paywall
 * until the profile picker is wired (packages/web/src/app/boot.ts FAMILY_ON); the release gate of content.test.ts (BA_RELEASE=1) asks for both.
 */
export const FAMILY_PLAN = true;

/**
 * Road Run runs in this many worlds, and `free` of them (Alps, Desert and Forest) are free; the others are part of Pro. The numbers are
 * core/render3d/themes/classic-worlds.json (every world has a `free` flag) and core/entitlements/features.ts DEFAULT_FREE_FEATURES
 * (world:alps, world:desert, world:forest); content.test.ts compares all three.
 */
export const ROAD_RUN_WORLDS = { total: 10, free: 3 } as const;

/**
 * Is the BodyArcade Android app on Google Play? False until the Play listing is public (the web release comes first). The pages that
 * mention the app say "planned" while this is false and "available" when it is true; set it in the release that goes with the listing.
 */
export const ANDROID_APP_LIVE = false;

/**
 * Does the site load an analytics script? False: no page of the app or of these pages loads one. The day Cloudflare Web Analytics (cookieless)
 * is switched on for the site, set this to true: the privacy policy then says that visits are counted, in the same release.
 */
export const ANALYTICS_ON = false;

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
/** The window of the automatic mute (hours) and of the automatic suspension (days). */
export const MUTE_WINDOW_HOURS = 24;
export const SUSPEND_WINDOW_DAYS = 7;
/** Different reporters within 24 hours for a serious reason (sexual content, a player who seems under 16) who do the same. */
export const URGENT_REPORTERS_TO_SUSPEND = 2;
/** A report counts towards those automatic steps only when the reporter's profile is at least this old, in hours. */
export const REPORTER_MIN_PROFILE_HOURS = 1;
/** The note an adult may add to a report. */
export const REPORT_NOTE_MAX_CHARS = 300;
/** Body points the pose model finds, and the joints a friend sees of you in a race. */
export const MODEL_POINTS = 33;
export const SHARED_JOINTS = 13;
/** About how often per second the skeleton and the score go to the other players of a room. */
export const SHARE_HZ = 15;
/** Characters of a room code, of a friend code (after "BA-") and of a recovery code. */
export const ROOM_CODE_CHARS = 6;
export const FRIEND_CODE_CHARS = 6;
export const RECOVERY_CODE_CHARS = 16;

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
/** The longest an abuse counter lives, in hours: the longest window is a day, and the sweep removes the row an hour after the window ends. */
export const LIMIT_COUNTER_HOURS = 25;
/** The level of a profile is a number from 1 to this. */
export const LEVEL_MAX = 99;
/** Devices one profile may hold at the same time (the oldest goes when a sixth is added). */
export const PROFILE_DEVICES = 5;
export const MAX_FRIENDS = { teen: 50, adult: 100 } as const;
/**
 * The age lines: no online identity below `online` (decided 24 Oct 23:00, raised from 13: GDPR art. 8 allows up to 16 and KVKK needs a
 * guardian for minors; Doruk confirmed it on 25 Oct), preset names and messages from there to 17, text and video from `video`.
 * The shell's words (core/ui/i18n: safety.age.*) and the friends screens say the same numbers; content.test.ts keeps them together.
 */
export const AGE = { online: 16, video: 18 } as const;

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
