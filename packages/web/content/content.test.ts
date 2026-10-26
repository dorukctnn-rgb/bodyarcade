// What the content pages say must be what the code does. Three kinds of test:
//   1. the pages are build products: the files under site/ are exactly what the sources produce (build.ts --check);
//   2. every fact of facts.ts (prices, periods, limits, ages) equals the constant of the code that does the thing;
//   3. every page is a good page: one h1, a canonical link, hreflang pairs, links that exist, no characters the style forbids,
//      Turkish with Turkish letters, and the same numbers in English and Turkish.
// With BA_RELEASE=1 (the production check) a last group asks whether the shell and the release have what the pages promise.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FREE_FEATURES, ROAD_RUN_WORLDS, canUse } from '../../core/entitlements/features.ts';
import { PLANS } from '../../core/entitlements/plans.ts';
import { GUMROAD_CATALOG } from '../../core/entitlements/catalog.ts';
import { DAY_MS, DIRECT_GRACE_MS, REFRESH_AFTER_MS } from '../../core/entitlements/state.ts';
import { MAX_TOKEN_TTL_S } from '../../core/entitlements/token.ts';
import { FREE_PLAN_ID, WORKOUT_PLANS, seatedFor } from '../../core/store/workout-plans.ts';
import { CHAT_INTERVAL_MS, CHAT_MAX_CHARS, NAME_MAX_CHARS } from '../../core/net/chat-filter.ts';
import { ROOM_CODE_LENGTH } from '../../core/net/codes.ts';
import { POSE_JOINTS } from '../../core/net/pose-frame.ts';
import { POSE_MODEL } from '../../core/pose/assets.ts';
import { POLICY, canSendFriendRequest, roomChatMode, roomVideoAllowed } from '../../core/social/age.ts';
import { FRIEND_CODE_LEN, RECOVERY_LEN } from '../../core/social/codes.ts';
import { MAX_LEVEL } from '../../core/social/levels.ts';
import { DAY, DECLINE_COOLDOWN_MS, HOUR, LIMITS, MOD, PRESENCE, REQUEST_TTL_MS, TERMS_VERSION, isTermsVersion } from '../../core/social/rules.ts';
import { KEEP_WEEKS } from '../../core/social/scores.ts';
import { createI18n } from '../../core/ui/i18n/index.ts';
import { MAX_SEATS, MIN_SEATS } from '../../core/types/net.ts';
import { LANDMARK_COUNT } from '../../core/types/index.ts';
import { DAY_S, FORGET_AFTER_S, REMINDER_LEAD_S, SEAT_IDLE_S } from '../../server/src/entitlements/rules.ts';
import { CHAT_LOG_LINES, DEFAULT_TIMING, MUTE_MS, REPORTS_TO_MUTE } from '../../server/src/live/config.ts';
import { LOBBY_STALE_MS } from '../../server/src/social/lobbies.ts';
import { REPORTER_MIN_AGE_MS } from '../../server/src/social/moderation.ts';
import { MAX_DEVICES } from '../../server/src/social/recovery.ts';
import { uxTables } from '../src/social/strings.ts';
import { COMMUNITY_RULES_ANCHOR, SITE_GUIDE_IDS, siteGuideHref, sitePageHref } from '../src/views/chrome.ts';
import { REGION_ORDER, ROUTES, router } from '../src/routes.ts';
import { AUDIT_KEEP_MS, LOBBY_GONE_MS, ORPHAN_REPORT_KEEP_MS, RESOLVED_REPORT_KEEP_MS, UNUSED_PROFILE_DAYS } from '../../server/src/social/sweep.ts';
import { REPO_ROOT, build, outOfDate, pages } from './build.ts';
import { FOOTER_GUIDES, OG_IMAGE, renderPage, type PageSpec } from './chrome.ts';
import { gameCounts, gameList, snapshotGames, snapshotIsCurrent } from './copy/games.ts';
import { GUIDE_URL, MOVE, SEO_URL, type SeoPage } from './copy/seo-shared.ts';
import * as F from './facts.ts';

const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

/** A constant the code does not export: the number after `const NAME =` in its source file. */
function constIn(rel: string, name: string): number {
  const m = new RegExp(`(?:export )?const ${name}(?::[^=]+)? = ([0-9_.]+)`).exec(read(rel));
  if (!m) throw new Error(`no constant ${name} in ${rel}`);
  return Number((m[1] as string).replace(/_/g, ''));
}

describe('the pages are build products', () => {
  it('site/ holds exactly what the sources produce (run node packages/web/content/build.ts)', () => {
    expect(outOfDate()).toEqual([]);
  });

  it('every file the build writes is a page or a shared file that exists', () => {
    for (const o of build()) expect(o.content.length, o.file).toBeGreaterThan(100);
  });

  it('the pages count the games the manifests describe: a warning when a manifest moved on, a failure at the launch check (BA_RELEASE=1)', () => {
    const current = snapshotIsCurrent();
    if (!current) console.warn('content pages: the game catalogue changed since the pages were built; run node packages/web/content/build.ts and commit site/ and the snapshot');
    if (process.env['BA_RELEASE'] === '1') expect(current, 'run node packages/web/content/build.ts').toBe(true);
  });

  it('the release builder takes every page from site/: LEGACY_PAGES (release/assemble.ts) is the list of pages', async () => {
    const { LEGACY_PAGES } = await import('../../../release/assemble.ts');
    expect(LEGACY_PAGES.map((p) => `${p.file} ${p.url}`).sort()).toEqual(pages().map((p) => `${p.file} ${p.url}`).sort());
  });

  it('the share image is the Play feature graphic of the English set, 1024 by 500, and every page names it with those sizes', () => {
    const png = (rel: string): Buffer => readFileSync(join(REPO_ROOT, rel));
    const size = (b: Buffer): { w: number; h: number } => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
    const shared = png(`site/assets/brand/${OG_IMAGE.file}`);
    expect(shared.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(size(shared)).toEqual({ w: OG_IMAGE.width, h: OG_IMAGE.height });
    // the new art (design/store/export/en), not the older one at the top of that folder
    expect(Buffer.compare(shared, png('design/store/export/en/feature-graphic.png'))).toBe(0);
    for (const p of pages()) {
      const html = renderPage(p);
      expect(html, p.file).toContain(`<meta property="og:image" content="https://bodyarcade.com/assets/brand/${OG_IMAGE.file}">`);
      expect(html, p.file).toContain(`<meta property="og:image:width" content="${OG_IMAGE.width}">`);
      expect(html, p.file).toContain(`<meta property="og:image:height" content="${OG_IMAGE.height}">`);
    }
  });

  it('each page has its own file and its own address', () => {
    const list = pages();
    expect(new Set(list.map((p) => p.file)).size).toBe(list.length);
    expect(new Set(list.map((p) => p.url)).size).toBe(list.length);
  });
});

describe('the plans and the prices are the code', () => {
  it('web prices', () => {
    expect(PLANS['pro-monthly'].price).toBe(F.PRICE.proMonthly);
    expect(PLANS['pro-yearly'].price).toBe(F.PRICE.proYearly);
    expect(PLANS['family-yearly'].price).toBe(F.PRICE.familyYearly);
    expect(PLANS.lifetime.price).toBe(F.PRICE.lifetime);
    expect(PLANS['legacy-monthly'].price).toBe(F.PRICE.legacyMonthly);
    expect(PLANS.founder.price).toBe(F.PRICE.founder);
  });

  it('billing periods: monthly, yearly, yearly, once; the legacy plans are not sold', () => {
    expect(PLANS['pro-monthly'].period).toBe('month');
    expect(PLANS['pro-yearly'].period).toBe('year');
    expect(PLANS['family-yearly'].period).toBe('year');
    expect(PLANS.lifetime.period).toBe('once');
    expect(PLANS['legacy-monthly'].sold).toBe(false);
    expect(PLANS.founder.sold).toBe(false);
  });

  it('the 7 day trial is Pro yearly only', () => {
    expect(PLANS['pro-yearly'].trialDays).toBe(F.TRIAL_DAYS);
    for (const id of ['pro-monthly', 'family-yearly', 'lifetime', 'legacy-monthly', 'founder'] as const) expect(PLANS[id].trialDays, id).toBeUndefined();
  });

  it('devices and profiles', () => {
    expect(PLANS['pro-monthly'].devices).toBe(F.DEVICES.pro);
    expect(PLANS['pro-yearly'].devices).toBe(F.DEVICES.pro);
    expect(PLANS.lifetime.devices).toBe(F.DEVICES.pro);
    expect(PLANS['legacy-monthly'].devices).toBe(F.DEVICES.pro);
    expect(PLANS['family-yearly'].devices).toBe(F.DEVICES.family);
    expect(PLANS.founder.devices).toBe(F.DEVICES.founder);
    expect(PLANS['family-yearly'].profiles).toBe(F.FAMILY_PROFILES);
    expect(PLANS.founder.profiles).toBe(F.FAMILY_PROFILES);
    expect(PLANS['pro-yearly'].profiles).toBe(1);
  });

  it('the Family plan the pages describe has its Gumroad product', () => {
    expect(F.FAMILY_PLAN).toBe(true);
    expect(GUMROAD_CATALOG['family-yearly'].productId).toMatch(/^[A-Za-z0-9_=-]{8,64}$/);
    expect(PLANS['family-yearly'].sold).toBe(true);
  });

  it('the reminder goes two days before the trial ends and the licence lasts at most 7 days, checked about daily', () => {
    expect(REMINDER_LEAD_S / DAY_S).toBe(F.REMINDER_DAYS);
    expect(MAX_TOKEN_TTL_S / DAY_S).toBe(F.LICENCE_DAYS);
    expect(REFRESH_AFTER_MS / 3_600_000).toBe(F.RENEW_HOURS);
    expect(DIRECT_GRACE_MS / DAY_MS).toBe(F.DIRECT_GRACE_DAYS);
  });

  it('what the license service forgets, and when', () => {
    expect(SEAT_IDLE_S / DAY_S).toBe(F.SEAT_IDLE_DAYS);
    expect(FORGET_AFTER_S / DAY_S).toBe(F.FORGET_PURCHASE_DAYS);
    expect(constIn('packages/server/src/entitlements/engine.ts', 'REMINDER_MAX_TRIES')).toBe(F.REMINDER_TRIES);
    const engine = read('packages/server/src/entitlements/engine.ts');
    // a purchase is forgotten only when it is not active and no device holds it; a reminder goes when the trial is over or after the tries
    expect(engine).toContain("status != 'active' AND checked_at < ?1 AND NOT EXISTS (SELECT 1 FROM seats");
    expect(engine).toContain('DELETE FROM reminders WHERE trial_end < ?1 OR tries >= ?2');
  });

  it('the reminder e-mail is plain text and holds no tracking', () => {
    const mail = read('packages/server/src/entitlements/mail.ts');
    expect(mail).toContain('body: JSON.stringify({ from: o.from, to: m.to, subject: m.subject, text: m.text })');
    expect(mail).not.toMatch(/\bhtml:/);
  });
});

describe('live play is the code', () => {
  it('rooms: seats, lifetime, chat log', () => {
    expect(MIN_SEATS).toBe(F.SEATS.min);
    expect(MAX_SEATS).toBe(F.SEATS.max);
    expect(DEFAULT_TIMING.emptyTtlMs / 60_000).toBe(F.ROOM_EMPTY_MINUTES);
    expect(DEFAULT_TIMING.roomTtlMs / 3_600_000).toBe(F.ROOM_IDLE_HOURS);
    expect(CHAT_LOG_LINES).toBe(F.CHAT_KEEP_LINES);
    expect(MOD.evidenceLines).toBe(F.CHAT_KEEP_LINES);
    expect(ROOM_CODE_LENGTH).toBe(F.ROOM_CODE_CHARS);
  });

  it('chat and names', () => {
    expect(CHAT_MAX_CHARS).toBe(F.CHAT_MAX_CHARS);
    expect(CHAT_INTERVAL_MS / 1000).toBe(F.CHAT_GAP_SECONDS);
    expect(NAME_MAX_CHARS).toBe(F.NAME_MAX_CHARS);
  });

  it('what the other players of a room receive: the pose model has 33 points, a race shares 13 joints about fifteen times a second', () => {
    expect(LANDMARK_COUNT).toBe(F.MODEL_POINTS);
    expect(POSE_JOINTS.length).toBe(F.SHARED_JOINTS);
    const gap = constIn('packages/core/net/race.ts', 'GHOST_GAP_MS');
    expect(1000 / gap).toBeGreaterThanOrEqual(F.SHARE_HZ - 1);
    expect(1000 / gap).toBeLessThanOrEqual(F.SHARE_HZ + 2);
  });

  it('the room server relays and keeps nothing of a relay or a signal', () => {
    const engine = read('packages/server/src/live/room-engine.ts');
    expect(engine).toContain("this.broadcast({ t: 'relay', from: mem.seat, d }, mem.seat);");
    expect(engine).toContain("if (c) this.send(c, { t: 'signal', from: mem.seat, d });");
    expect(read('packages/server/src/live/room.ts')).toContain("const STORED_KEYS = ['meta', 'members', 'match', 'ev', 'chat', 'reports'];");
  });

  it('STUN is Cloudflare, and there is no relay until the two TURN secrets are in', () => {
    const ice = read('packages/server/src/live/ice.ts');
    expect(ice).toContain("stun:stun.cloudflare.com:3478");
    expect(ice).toContain('if (env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN)');
    const secrets = read('release/secrets.ts');
    for (const name of ['TURN_KEY_ID', 'TURN_KEY_API_TOKEN']) expect(secrets).toMatch(new RegExp(`name: '${name}'[^\\n]*required: false`));
    expect(F.RELAY_ON).toBe(false);
  });
});

describe('the online profile is the code', () => {
  it('who may do what at which age', () => {
    expect(POLICY.child.online).toBe(false);
    expect(POLICY.teen.online).toBe(true);
    expect(POLICY.teen.presetNameOnly).toBe(true);
    expect(POLICY.teen.freeText).toBe(false);
    expect(POLICY.teen.video).toBe(false);
    expect(POLICY.teen.publicPlay).toBe(true);
    expect(POLICY.adult.presetNameOnly).toBe(false);
    expect(POLICY.adult.freeText).toBe(true);
    expect(POLICY.adult.video).toBe(true);
    expect(POLICY.teen.maxFriends).toBe(F.MAX_FRIENDS.teen);
    expect(POLICY.adult.maxFriends).toBe(F.MAX_FRIENDS.adult);
    expect(canSendFriendRequest('adult', 'teen')).toBe(false);
    expect(canSendFriendRequest('teen', 'adult')).toBe(true);
    expect(roomChatMode(['adult', 'adult'], 'private')).toBe('text');
    expect(roomChatMode(['adult', 'teen'], 'private')).toBe('preset');
    expect(roomChatMode(['adult', 'adult'], 'public')).toBe('preset');
    expect(roomVideoAllowed(['adult', 'adult'], 'private')).toBe(true);
    expect(roomVideoAllowed(['adult', 'adult'], 'public')).toBe(false);
    expect(roomVideoAllowed(['adult', 'teen'], 'private')).toBe(false);
  });

  it('the ages 16 and 18 are the ones the app says', () => {
    const en = read('packages/core/ui/i18n/en.ts');
    expect(en).toContain(`'safety.age.child': 'Under ${F.AGE.online}'`);
    expect(en).toContain(`'safety.age.teen': '${F.AGE.online} to 17'`);
    expect(en).toContain(`'safety.age.adult': '${F.AGE.video} or older'`);
    expect(en).toContain(`everyone in this room is ${F.AGE.video} or older`);
  });

  it('codes, devices and levels', () => {
    expect(FRIEND_CODE_LEN).toBe(F.FRIEND_CODE_CHARS);
    expect(RECOVERY_LEN).toBe(F.RECOVERY_CODE_CHARS);
    expect(MAX_DEVICES).toBe(F.PROFILE_DEVICES);
    expect(MAX_LEVEL).toBe(F.LEVEL_MAX);
  });

  it('how long each kind of record lives', () => {
    expect(UNUSED_PROFILE_DAYS).toBe(F.UNUSED_PROFILE_DAYS);
    expect(REQUEST_TTL_MS / DAY).toBe(F.REQUEST_DAYS);
    expect(DECLINE_COOLDOWN_MS / DAY).toBe(F.DECLINE_DAYS);
    expect(PRESENCE.ttlMs / 60_000).toBe(F.PRESENCE_MINUTES);
    expect(LOBBY_STALE_MS / 60_000).toBe(F.LOBBY_HIDE_MINUTES);
    expect(LOBBY_GONE_MS / HOUR).toBe(F.LOBBY_GONE_HOURS);
    expect(KEEP_WEEKS).toBe(F.BOARD_WEEKS);
    expect(RESOLVED_REPORT_KEEP_MS / DAY).toBe(F.RESOLVED_REPORT_DAYS);
    expect(ORPHAN_REPORT_KEEP_MS / DAY).toBe(F.ORPHAN_REPORT_DAYS);
    expect(AUDIT_KEEP_MS / DAY).toBe(F.AUDIT_DAYS);
  });

  it('the counters of the abuse limits live about a day: the longest window is 24 hours and its row goes an hour after', () => {
    const longest = Math.max(...Object.values(LIMITS).map((l) => l.windowMs));
    expect((longest + HOUR) / HOUR).toBe(F.LIMIT_COUNTER_HOURS);
    expect(read('packages/server/src/social/limits.ts')).toContain('windowOf(now, spec.windowMs).end + HOUR');
  });

  it('reports: the automatic mute and suspension', () => {
    expect(MOD.reportersToMute).toBe(F.REPORTS_TO_MUTE);
    expect(REPORTS_TO_MUTE).toBe(F.REPORTS_TO_MUTE);
    expect(MOD.muteMs / HOUR).toBe(F.MUTE_HOURS);
    expect(MUTE_MS / HOUR).toBe(F.MUTE_HOURS);
    expect(MOD.reportersToSuspend).toBe(F.REPORTS_TO_SUSPEND);
    expect(MOD.suspendMs / DAY).toBe(F.SUSPEND_DAYS);
    expect(MOD.urgentReportersToSuspend).toBe(F.URGENT_REPORTERS_TO_SUSPEND);
    expect(MOD.noteMaxChars).toBe(F.REPORT_NOTE_MAX_CHARS);
    expect(REPORTER_MIN_AGE_MS / HOUR).toBe(F.REPORTER_MIN_PROFILE_HOURS);
    const mod = read('packages/server/src/social/moderation.ts');
    expect(mod).toContain('r.target = ?1 AND r.at > ?2 AND rp.created_at <= r.at - ?4) AS r24');
    expect(mod).toContain('r.at - DAY, r.at - 7 * DAY');
    expect(F.MUTE_WINDOW_HOURS).toBe(24);
    expect(F.SUSPEND_WINDOW_DAYS).toBe(7);
  });

  it('deleting a profile leaves exactly what the privacy policy says it leaves', () => {
    const people = read('packages/server/src/social/people.ts');
    for (const table of ['soc_devices', 'soc_friends', 'soc_requests', 'soc_blocks', 'soc_declines', 'soc_presence', 'soc_scores', 'soc_sync', 'soc_profiles']) expect(people, table).toContain(`DELETE FROM ${table}`);
    expect(people).toContain('UPDATE soc_reports SET reporter = NULL WHERE reporter = ?1');
    expect(people).toContain("UPDATE soc_reports SET target_name = '', note = NULL WHERE target = ?1");
    // the lobby directory (rooms) and the reports about the person are not in the list of what is erased with the profile
    expect(people).not.toContain('DELETE FROM soc_lobbies');
    expect(people).not.toContain('DELETE FROM soc_reports');
  });

  it('the data export holds what the privacy policy says it holds', () => {
    const profile = read('packages/server/src/social/profile.ts');
    for (const key of ['profile: bare', 'friends,', 'incoming,', 'outgoing,', 'blocks,', 'scores: await scoresOf', 'sync: await syncDocs', 'reportsFiled', 'reportsAgainstYou', 'termsAccepted']) expect(profile, key).toContain(key);
    expect(profile).not.toMatch(/export:[^;]*soc_devices/);
  });

  it('the recovery code stays valid when used and a new one replaces it; only a hash is kept', () => {
    const rec = read('packages/server/src/social/recovery.ts');
    expect(rec).toContain('The code stays valid');
    const prof = read('packages/server/src/social/profile.ts');
    expect(prof).toContain('UPDATE soc_profiles SET recovery = ?2 WHERE pid = ?1');
    expect(prof).toContain('The recovery code is in this answer and nowhere else, ever: the server keeps a hash.');
  });

  it('the address is stored only as a keyed hash; the two other services keep theirs in memory', () => {
    expect(read('packages/server/src/social/util.ts')).toContain('the only form in which an address is ever stored');
    expect(read('packages/server/src/live/limits.ts')).toContain('Counters live in the Worker isolate');
    expect(read('packages/server/src/entitlements/engine.ts')).toContain('limits (in memory');
  });
});

describe('the pose model and the games', () => {
  it('the model is about 6 MB and is served from this site', () => {
    expect(POSE_MODEL.bytes).toBeGreaterThan(5_500_000);
    expect(POSE_MODEL.bytes).toBeLessThan(6_500_000);
    expect(POSE_MODEL.url.startsWith('/vendor/')).toBe(true);
  });

  it('the Google telemetry request is stopped on the device', () => {
    expect(read('packages/core/pose/no-telemetry.ts')).toContain("'odml.pa.googleapis.com'");
  });

  it('no code of ours sets a cookie, and no page loads an analytics script', () => {
    for (const rel of ['packages/core/store/store.ts', 'packages/web/src/app/app.ts', 'packages/web/src/main.ts', 'packages/web/src/document.ts']) expect(read(rel), rel).not.toContain('document.cookie');
    expect(F.ANALYTICS_ON).toBe(false);
    for (const p of pages()) expect(renderPage(p), p.file).not.toMatch(/<script[^>]+src=/);
  });

  it('the catalogue the pages count: every game has a seated version, the free and Pro games are the manifests, the live races are the games whose manifest lists a duel', () => {
    const games = gameList('en');
    expect(games.length).toBeGreaterThan(0);
    expect(games.every((g) => g.seated)).toBe(true);
    expect(games.filter((g) => g.live).map((g) => g.id).sort()).toEqual(['knee-sprint', 'reaction-tag', 'squat-flap']);
    const terms = renderPage(pages().find((p) => p.file === 'terms.html') as PageSpec);
    for (const g of games.filter((x) => !x.free)) expect(terms).toContain(g.title);
  });

  it('the distances the FAQ gives are the ones the app tells the player', () => {
    const en = read('packages/core/ui/i18n/en.ts');
    expect(en).toContain('Stand 2 to 3 m from a laptop or 1.5 to 2 m from an upright phone.');
    expect(en).toContain('Sit or stand about 1 m away.');
    const faq = renderPage(pages().find((p) => p.file === 'faq.html') as PageSpec);
    expect(faq).toContain('stand 2 to 3 metres from a laptop or 1.5 to 2 metres from an upright phone');
    expect(faq).toContain('about 1 metre away');
  });

  it('how to cancel is where the app says it is', () => {
    const en = read('packages/core/ui/i18n/en.ts');
    expect(en).toContain("'paywall.cancel.web': 'Cancel any time in your Gumroad library.'");
    expect(en).toContain("'paywall.cancel.play': 'Cancel any time in Google Play subscriptions.'");
  });
});

// ───────── every page ─────────

const visible = (html: string): string => html.replace(/<head>[\s\S]*?<\/head>/, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&mdash;|&ndash;/g, '')
  .replace(/&ldquo;|&rdquo;/g, '"').replace(/&lsquo;|&rsquo;/g, "'").replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&uuml;/g, 'ü')
  .replace(/\s+/g, ' ').trim();

const all = pages();
const byFile = new Map(all.map((p) => [p.file, p]));

describe.each(all.map((p) => [p.file, p] as const))('%s', (_file, spec) => {
  const html = renderPage(spec);
  const text = visible(html);

  it('is a whole document with the right language, one h1, a canonical link and a title with the brand', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain(`<html lang="${spec.lang}">`);
    expect(html.match(/<h1[ >]/g)?.length).toBe(1);
    expect(html).toContain(`<link rel="canonical" href="${F.SITE}${spec.url}">`);
    expect(html).toMatch(/<title>[^<]+ \| BodyArcade<\/title>/);
    expect(spec.description.length).toBeGreaterThan(60);
    expect(spec.description.length).toBeLessThanOrEqual(165);
    expect(text.length).toBeGreaterThan(600);
  });

  it('reads as written: no sentence is glued to the next, no word is doubled, no space is missing after a comma', () => {
    expect(text.match(/[a-zçğıöşü]{2}[.!?][A-ZÇĞİÖŞÜ0-9]/g) ?? []).toEqual([]);
    // doubled words are looked for inside one run of text: the same word may end a heading and start the next element
    const prose = html.replace(/<head>[\s\S]*?<\/head>/, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, '\u0001');
    // (a Turkish word said twice on purpose, "uzuv uzuv" for limb by limb, is Turkish and not a slip)
    expect((prose.match(/\b([A-Za-zÇĞİÖŞÜçğıöşü]{3,}) \1\b/g) ?? []).filter((d) => !(spec.lang === 'tr' && /^(uzuv uzuv|tek tek|ayrı ayrı|birer birer)$/i.test(d)))).toEqual([]);
    expect(text.match(/[a-zçğıöşü],[A-Za-zÇĞİÖŞÜçğıöşü]/g) ?? []).toEqual([]);
    expect(text).not.toMatch(/\bundefined\b|\bnull\b|\[object Object\]|\$\{/);
  });

  it('has its other-language page, which points back', () => {
    if (!spec.other) return;
    const other = all.find((p) => p.url === spec.other?.url);
    expect(other, `the page ${spec.other.url} exists`).toBeDefined();
    expect(other?.other?.url).toBe(spec.url);
    expect(other?.lang).toBe(spec.other.lang);
    expect(html).toContain(`hreflang="${spec.other.lang}" href="${F.SITE}${spec.other.url}"`);
  });

  it('every link on it goes somewhere that exists', () => {
    const games = new Set(gameList('en').map((g) => g.slug));
    const known = new Set<string>(['/', '/tr/', '/pro/', '/tr/pro/', '/blog/', '/favicon-32.png', '/apple-touch-icon.png', ...all.map((p) => p.url)]);
    for (const m of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      const url = m[1] as string;
      if (/^(https:|mailto:|#)/.test(url)) continue;
      const path = url.split('#')[0] as string;
      if (path === '') continue;
      if (path.startsWith('/assets/')) { expect(existsSync(join(REPO_ROOT, 'site', path)), `${spec.file}: ${path}`).toBe(true); continue; }
      const g = /^(?:\/tr)?\/games\/([a-z0-9-]+)\/$/.exec(path);
      if (g) { expect(games.has(g[1] as string), `${spec.file}: ${path}`).toBe(true); continue; }
      // the app's own lists: one per body area (it has to have a game) and the workout plans
      const area = /^(?:\/tr)?\/workouts\/([a-z-]+)\/$/.exec(path);
      if (area) {
        const m = router.match(path);
        expect(m?.id, `${spec.file}: ${path}`).toBe('region');
        expect(gameList('en').some((x) => x.regions.includes(area[1] as never) || (area[1] === 'seated' && x.seated)), `${spec.file}: ${path} has games`).toBe(true);
        continue;
      }
      if (/^(?:\/tr)?\/plans\/$/.test(path)) { expect(router.match(path)?.id, `${spec.file}: ${path}`).toBe('plans'); continue; }
      expect(known.has(path), `${spec.file} links to ${path}`).toBe(true);
    }
  });

  it('uses none of the characters and phrases the style forbids', () => {
    expect(text).not.toMatch(/—/);
    expect(text).not.toMatch(/(?<=\D)–(?=\D)|\s–\s/);
    expect(text).not.toMatch(/[a-z,)] - [a-zA-Z(]/);
    expect(text).not.toMatch(/[→←↗↘⟶➜➔»✓✔✅☑✗✘❌]/u);
    expect(text).not.toMatch(/(?![©®™★☆])\p{Extended_Pictographic}/u);
    expect(text).not.toMatch(/!/);
    for (const w of ['unlock', 'seamless', 'supercharge', 'game-changer', 'cutting-edge', 'state-of-the-art', 'leverage', 'stunning', 'magic', 'hassle-free', 'world-class']) expect(text.toLowerCase(), w).not.toContain(w);
  });

  it('has structured data that parses and names this page', () => {
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
    expect(ld).not.toBeNull();
    const data = JSON.parse(ld?.[1] ?? '{}') as { '@graph': { '@type': string }[] };
    expect(data['@graph'].some((g) => g['@type'] === 'BreadcrumbList')).toBe(true);
  });

  if (spec.lang === 'tr') {
    it('is Turkish with Turkish letters (no ASCII-fied words)', () => {
      expect(text).toMatch(/[çğıöşüÇĞİÖŞÜ]/);
      const ascii = /\b(icin|degil|cocuk|cocuklar|guvenlik|kullanici|gunluk|ucretsiz|sifre|saglik|goruntu|baglanti|secenek|dusuk|oturarak|Turkce|gizlilik)\b/g;
      // "oturarak" and "gizlilik" are Turkish as they are; the rest are Turkish words missing their letters
      const bad = [...text.matchAll(ascii)].map((m) => m[0]).filter((w) => w !== 'oturarak' && w.toLowerCase() !== 'gizlilik');
      expect(bad).toEqual([]);
    });
  }
});

describe('English and Turkish say the same numbers', () => {
  const numbers = (spec: PageSpec): string[] => {
    const t = visible(renderPage(spec))
      .replace(/BA-[0-9A-Z]{6}/g, ' ')
      .replace(/a\*+@example\.com/g, ' ')
      .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
      .replace(/(\d),(\d)/g, '$1.$2');
    return [...new Set(t.match(/\d+(?:\.\d+)?/g) ?? [])].sort((a, b) => Number(a) - Number(b));
  };
  for (const [en, tr] of [['privacy.html', 'tr/privacy.html'], ['terms.html', 'tr/terms.html'], ['faq.html', 'tr/faq.html'], ['delete-account.html', 'tr/delete-account.html']] as const) {
    it(`${en} and ${tr}`, () => {
      expect(numbers(byFile.get(tr) as PageSpec)).toEqual(numbers(byFile.get(en) as PageSpec));
    });
  }
});

// What Doruk decided on 25 Oct 2026 (NOTLAR-content.md, "DORUK CEVAPLARI"): the pages must keep saying it.
describe('the owner\'s decisions of 25 October are on the pages', () => {
  const textOf = (file: string): string => visible(renderPage(byFile.get(file) as PageSpec));
  const legal = ['privacy.html', 'tr/privacy.html', 'terms.html', 'tr/terms.html', 'faq.html', 'tr/faq.html'];

  it('the maker is a person who trades under a name, not a company, and no street address is published', () => {
    for (const f of legal) {
      const t = textOf(f);
      expect(t, f).toContain(F.OWNER);
      expect(t, f).toContain(F.STUDIO);
    }
    for (const p of all) {
      const t = textOf(p.file);
      expect(t, p.file).not.toMatch(/Peak Apps Studio[^.]{0,60}\b(company|Ltd|Inc|LLC|Limited|corporation)\b/i);
      expect(t, p.file).not.toMatch(/Peak Apps Studio[^.]{0,60}(şirket|A\.Ş|Ltd\. ?Şti)/i);
      expect(t, p.file).not.toMatch(/\b(Mah\.|Mahallesi|Sok\.|Sokak|Cad\.|Caddesi|No:)\s/);
    }
    expect(textOf('privacy.html')).toContain('an individual who trades as');
    expect(textOf('tr/privacy.html')).toContain('gerçek kişi');
    expect(textOf('terms.html')).toContain('an individual who trades as');
    expect(textOf('tr/terms.html')).toContain('gerçek kişi');
  });

  // The name is said "bodi arkeyd": Turkish suffixes follow the last vowel, e (BodyArcade’i, ’in, ’e, ’de), never the back-vowel forms.
  it('every Turkish page puts the suffix after BodyArcade as the name is said: -i, -in, -e, -de, never -ı, -ın, -a, -da', () => {
    const wrong = /BodyArcade[’'](ı|ın|a|da|dan|ya|yı|nın|la|yla|ta|tan)(?![A-Za-zÇĞİÖŞÜçğıöşü])/;
    const tr = all.filter((p) => p.lang === 'tr');
    expect(tr.length).toBeGreaterThan(8);
    for (const p of tr) expect(renderPage(p), p.file).not.toMatch(wrong);
  });

  // 26 Oct (release 2): no ENT_MAIL_* secrets on the Worker, so the server sends no reminder e-mail and the Pro screen offers no address box.
  // The pages and the paywall then promise only the notice in the app (and Google Play's own reminder) until facts.ts REMINDER_MAIL is on.
  it('the trial reminder is promised as the server keeps it: no reminder e-mail while REMINDER_MAIL is off', () => {
    const pages = [...legal, 'delete-account.html', 'tr/delete-account.html'];
    const mailWords = /reminder e-mail|e-mail reminder|send one e-mail|left for the trial reminder|hatırlatma e-postası|e-posta hatırlatması|tek bir e-posta göndeririz|Deneme hatırlatması için/i;
    for (const f of pages) {
      const t = textOf(f);
      if (F.REMINDER_MAIL) expect(t, f).toMatch(mailWords);
      else expect(t, f).not.toMatch(mailWords);
    }
    for (const f of ['faq.html', 'terms.html']) expect(textOf(f), f).toContain(`We remind you ${F.REMINDER_DAYS} days before`);
    for (const f of ['tr/faq.html', 'tr/terms.html']) expect(textOf(f), f).toContain(`${F.REMINDER_DAYS} gün önce sana hatırlatırız`);
    expect(textOf('privacy.html')).toContain('the app shows a notice on every open');
    expect(textOf('tr/privacy.html')).toContain('uygulama her açılışta bir bildirim gösterir');
    // the paywall line of the web says what is kept on every server: the notice in the app
    const app = { en: createI18n('en'), tr: createI18n('tr') };
    expect(app.en.tx('paywall.reminder.web')).not.toMatch(/e-?mail/i);
    expect(app.tr.tx('paywall.reminder.web')).not.toMatch(/e-?posta/i);
  });

  it('Lifetime lasts as long as BodyArcade is offered, promises no refund if the service closes, and leaves statutory rights alone', () => {
    for (const f of ['terms.html', 'faq.html']) {
      expect(textOf(f), f).toContain('for as long as BodyArcade is offered');
      expect(textOf(f), f).toContain('rights as a consumer under the law are not affected');
    }
    for (const f of ['tr/terms.html', 'tr/faq.html']) {
      expect(textOf(f), f).toContain('BodyArcade sunulduğu sürece');
      expect(textOf(f), f).toContain('tüketici haklarına bu durum dokunmaz');
    }
    for (const p of all) expect(textOf(p.file), p.file).not.toMatch(/refund the unused part|fair share of the price|kullanılmayan kısmını iade|fiyatın makul bir payı/i);
  });

  it('Pro includes the games added later, while a membership is active and on the Lifetime plan', () => {
    for (const f of ['terms.html', 'faq.html']) expect(textOf(f), f).toMatch(/(games we add later|later games) are included while .{0,70}membership is active, and on the Lifetime plan/);
    for (const f of ['tr/terms.html', 'tr/faq.html']) expect(textOf(f), f).toMatch(/Daha sonra eklenen oyunlar, .{0,70} üyeliklerinden biri etkin olduğu sürece ve Ömür boyu planda dahildir/);
  });

  it('nobody under 16 has an online identity, and 13 is nowhere an age in the pages', () => {
    expect(F.AGE.online).toBe(16);
    expect(POLICY.child.online).toBe(false);
    for (const p of all) {
      expect(textOf(p.file), p.file).not.toMatch(/\b(under|below|younger than|aged?|over|older than) 13\b|\b13 (and|or) (older|over|up)|\b13\+|\b13-17|\b13 to 17|\b13 ile 17|\b13 yaş|\b13 altı/i);
    }
    expect(textOf('privacy.html')).toContain(`Players under ${F.AGE.online} do not get an online profile`);
    expect(textOf('tr/privacy.html')).toContain(`${F.AGE.online} yaşından küçük oyuncuların çevrimiçi profili olmaz`);
  });

  it('the plans bought on the web have a 14 day refund period, in both languages, and the app says no other one', () => {
    expect(F.REFUND_DAYS).toBe(14);
    for (const f of ['terms.html', 'faq.html']) expect(textOf(f), f).toContain(`refunded within ${F.REFUND_DAYS} days of buying it`);
    for (const f of ['tr/terms.html', 'tr/faq.html']) expect(textOf(f), f).toContain(`${F.REFUND_DAYS} gün içinde iade edilebilir`);
    for (const rel of ['packages/core/ui/i18n/en.ts', 'packages/core/ui/i18n/tr.ts']) {
      for (const m of read(rel).matchAll(/(\d+)[- ]?(?:day|gün)[^'\n]{0,30}(?:refund|money.?back|iade)|(?:refund|iade)[^'\n]{0,40}?(\d+)[- ]?(?:day|gün)/gi)) {
        expect(Number(m[1] ?? m[2]), `${rel}: ${m[0]}`).toBe(F.REFUND_DAYS);
      }
    }
  });

  it('no page claims that a lawyer looked at it', () => {
    for (const p of all) expect(textOf(p.file), p.file).not.toMatch(/\b(lawyer|attorney|legal review|avukat|hukuki inceleme)\b/i);
  });
});

// The sign-up of an online profile asks for the terms, and the pages and the server keep to that.
describe('the sign-up asks for the terms and the community rules', () => {
  const html = (file: string): string => renderPage(byFile.get(file) as PageSpec);

  it('the version the sign-up sends is the date of the terms and of the privacy policy, and is a day', () => {
    expect(TERMS_VERSION).toBe(F.UPDATED);
    expect(isTermsVersion(TERMS_VERSION)).toBe(true);
    for (const bad of ['', 'yes', 20261025, '2026-13-45', '2026-10-25T10:00:00Z', null, undefined]) expect(isTermsVersion(bad), String(bad)).toBe(false);
  });

  it('the links of the sign-up lead to the terms, to the community rules and to the privacy policy, which are on the site in the same language', () => {
    for (const [lang, terms, privacy] of [['en', 'terms.html', 'privacy.html'], ['tr', 'tr/terms.html', 'tr/privacy.html']] as const) {
      expect(sitePageHref(lang, 'terms')).toBe((byFile.get(terms) as PageSpec).url);
      expect(sitePageHref(lang, 'privacy')).toBe((byFile.get(privacy) as PageSpec).url);
      const id = COMMUNITY_RULES_ANCHOR[lang];
      expect(html(terms), `${terms} #${id}`).toContain(`<section id="${id}" aria-labelledby="${id}-h"><h2 id="${id}-h">`);
      // the heading the link lands on is called what the sign-up calls it
      expect(visible(html(terms)), terms).toContain(lang === 'en' ? 'Community rules' : 'Topluluk kuralları');
    }
  });

  it('the terms say that the app asks for the agreement and keeps the version, in both languages', () => {
    expect(visible(html('terms.html'))).toContain('asks you to tick a box that says you agree to these terms and to the community rules below, and it keeps the version of the terms you agreed to with the profile');
    expect(visible(html('tr/terms.html'))).toContain('kabul ettiğin koşulların sürümünü profille birlikte saklar');
  });

  it('the server keeps the version with the profile and the delete takes it away; nothing requires it', () => {
    const profile = read('packages/server/src/social/profile.ts');
    expect(profile).toContain("b.terms !== undefined && !isTermsVersion(b.terms)");
    expect(profile).toContain('terms, terms_at) VALUES');
    expect(read('packages/server/src/social/schema.ts')).toContain('ALTER TABLE soc_profiles ADD COLUMN terms TEXT');
    expect(read('packages/server/src/social/people.ts')).toContain('DELETE FROM soc_profiles WHERE pid = ?1');
  });
});

// The page that Google Play's data safety form names for deleting the account: what it says is what the app and the server do.
describe('the page on deleting the account is what the app and the server do', () => {
  const textOf = (file: string): string => visible(renderPage(byFile.get(file) as PageSpec));
  const html2 = (file: string): string => renderPage(byFile.get(file) as PageSpec);
  const pages2 = [['en', 'delete-account.html'], ['tr', 'tr/delete-account.html']] as const;

  it('names the screens and the buttons exactly as the app writes them', () => {
    for (const [lang, file] of pages2) {
      const text = textOf(file);
      const ux = uxTables[lang];
      const shell = createI18n(lang);
      const labels = [ux['me.dataDownload'], ux['me.dataDelete'], ux['me.dataDeleteTitle'], ux['friends.profile'], ux['age.have'], ux['me.dataTitle'], shell.tx('nav.friends'), shell.tx('social.intro.cta'), shell.tx('settings.data.clear')];
      for (const label of labels) {
        expect(label, `${lang} label`).toBeTruthy();
        expect(text, `${file}: ${label}`).toContain(label as string);
      }
    }
  });

  it('says the numbers the code keeps: reports, the safety log, rooms, the room list, unused profiles, the licence service', () => {
    for (const [, file] of pages2) {
      const text = textOf(file);
      for (const n of [F.RESOLVED_REPORT_DAYS, F.ORPHAN_REPORT_DAYS, F.AUDIT_DAYS, F.UNUSED_PROFILE_DAYS, F.SEAT_IDLE_DAYS, F.FORGET_PURCHASE_DAYS, F.ROOM_EMPTY_MINUTES, F.ROOM_IDLE_HOURS, F.LOBBY_HIDE_MINUTES, F.LOBBY_GONE_HOURS]) expect(text, `${file}: ${n}`).toContain(String(n));
    }
    expect(RESOLVED_REPORT_KEEP_MS / DAY).toBe(F.RESOLVED_REPORT_DAYS);
    expect(UNUSED_PROFILE_DAYS).toBe(F.UNUSED_PROFILE_DAYS);
  });

  it('the app and the e-mail request erase with the same function; a suspended profile can still download and delete', () => {
    const profile = read('packages/server/src/social/profile.ts');
    const moderation = read('packages/server/src/social/moderation.ts');
    expect(profile).toContain('await eraseProfile(c.db, c.me.pid)');
    expect(moderation).toContain('await eraseProfile(c.db, who.pid)');
    const routes = read('packages/server/src/social/routes.ts');
    expect(routes).toContain("['POST', '/api/admin/social/profiles/delete', () => adminDeleteProfile]");
    expect(routes).toContain("['GET', '/api/social/me/export', () => authed(exportMe, { allowBanned: true })]");
    expect(routes).toContain("['POST', '/api/social/me/delete', () => authed(deleteMe, { allowBanned: true })]");
    // the client forgets the key and the saved profile on the device, and the games and results stay
    expect(read('packages/core/social/client.ts')).toContain("await this.call('POST', '/api/social/me/delete', { confirm: 'delete' });\n    await this.forget('deleted');");
    expect(uxTables.en['me.dataDeleteBody']).toContain('Your games and records on this device stay.');
  });

  it('a Pro licence is not tied to the profile: nothing in the erase touches the licence service', () => {
    expect(read('packages/server/src/social/people.ts')).not.toMatch(/entitlements|licen[cs]e|seats|reminders/i);
  });

  it('is linked from every page of the site, from the privacy policy and the FAQ, from the app footer and from the settings', () => {
    for (const p of all) expect(renderPage(p), p.file).toContain(`<a href="${p.lang === 'tr' ? '/tr/delete-account' : '/delete-account'}">`);
    for (const [file, href] of [['privacy.html', '/delete-account'], ['tr/privacy.html', '/tr/delete-account'], ['faq.html', '/delete-account'], ['tr/faq.html', '/tr/delete-account']] as const) {
      expect(html2(file), file).toContain(`<a href="${href}">`);
    }
    expect(sitePageHref('en', 'delete')).toBe('/delete-account');
    expect(sitePageHref('tr', 'delete')).toBe('/tr/delete-account');
    expect(read('packages/web/src/views/chrome.ts')).toContain("sitePageHref(ctx.lang, 'delete')");
    expect(read('packages/web/src/views/settings.ts')).toContain("sitePageHref(ctx.lang, 'delete')");
  });

  it('has an address that the Play form can name: English at /delete-account, Turkish at /tr/delete-account, both public', () => {
    expect((byFile.get('delete-account.html') as PageSpec).url).toBe('/delete-account');
    expect((byFile.get('tr/delete-account.html') as PageSpec).url).toBe('/tr/delete-account');
    expect(read('release/site.ts')).not.toMatch(/Disallow: \/delete-account/);
  });
});

// Road Run has ten worlds; three are free. The pages and the paywall say it.
describe('Road Run: three of its ten worlds are free', () => {
  const textOf = (file: string): string => visible(renderPage(byFile.get(file) as PageSpec));

  it('the world list, the free features and the numbers of the pages agree', () => {
    const worlds = JSON.parse(read('packages/core/render3d/themes/classic-worlds.json')) as { id: string; free?: boolean }[];
    expect(worlds.length).toBe(F.ROAD_RUN_WORLDS.total);
    expect(worlds.filter((w) => w.free === true).map((w) => w.id).sort()).toEqual(['alps', 'desert', 'forest']);
    expect(worlds.filter((w) => w.free === true).length).toBe(F.ROAD_RUN_WORLDS.free);
    expect([...DEFAULT_FREE_FEATURES].filter((f) => f.startsWith('world:')).sort()).toEqual(['world:alps', 'world:desert', 'world:forest']);
    expect(ROAD_RUN_WORLDS).toEqual(F.ROAD_RUN_WORLDS);
  });

  it('the terms and the FAQ say it where they say what is free and what Pro adds, in English and Turkish', () => {
    const { total, free } = F.ROAD_RUN_WORLDS;
    for (const f of ['terms.html', 'faq.html']) {
      expect(textOf(f), f).toContain(`Road Run has ${total} worlds, and ${free} of them are free`);
      expect(textOf(f), f).toMatch(new RegExp(`the other ${total - free} Road Run worlds`));
    }
    expect(textOf('terms.html')).toContain(`${free} of the ${total} Road Run worlds; each Pro game once`);
    expect(textOf('terms.html')).toContain(`all ${total} Road Run worlds`);
    for (const f of ['tr/terms.html', 'tr/faq.html']) {
      expect(textOf(f), f).toContain(`Road Run’ın ${total} dünyası vardır ve ${free} tanesi ücretsizdir`);
      expect(textOf(f), f).toContain(`Road Run’ın diğer ${total - free} dünya`);
    }
    expect(textOf('tr/terms.html')).toContain(`Road Run’ın ${total} dünyasından ${free} tanesi; her Pro oyun bir kez`);
    expect(textOf('ring-fit-adventure-alternative.html')).toContain(`Free, ${free} of ${total} worlds`);
    expect(textOf('tr/ring-fit-adventure-alternatifi.html')).toContain(`Ücretsiz, ${total} dünyadan ${free} tanesi`);
  });

  it('the paywall says it in both languages (the free line and one line of what Pro adds)', () => {
    for (const lang of ['en', 'tr'] as const) {
      const t = createI18n(lang);
      expect(t.t('paywall.free.worlds', { free: ROAD_RUN_WORLDS.free, total: ROAD_RUN_WORLDS.total })).toContain(String(ROAD_RUN_WORLDS.free));
      expect(t.t('paywall.benefit.worlds', { n: ROAD_RUN_WORLDS.total - ROAD_RUN_WORLDS.free })).toContain('7');
    }
  });
});

// ───────── the search pages (copy/seo-*.ts): fitness games, seated games, games with friends, games by body area ─────────
// Each page answers one search question, so each claim on it is compared with what the build does: the manifests (through the
// snapshot), the workout plans, the entitlements, the app's own words and the routes of the app it links to.
describe('the search pages say what the build does', () => {
  const PAGES: Record<SeoPage, { en: string; tr: string }> = {
    hub: { en: 'fitness-games.html', tr: 'tr/evde-spor-oyunlari.html' },
    seated: { en: 'seated-exercise-games.html', tr: 'tr/oturarak-egzersiz-oyunlari.html' },
    friends: { en: 'workout-games-with-friends.html', tr: 'tr/arkadaslarla-spor-oyunlari.html' },
    areas: { en: 'workout-games-by-body-area.html', tr: 'tr/bolgeye-gore-spor-oyunlari.html' },
  };
  const kinds = Object.keys(PAGES) as SeoPage[];
  const LANGS2 = ['en', 'tr'] as const;
  const spec = (page: SeoPage, lang: 'en' | 'tr'): PageSpec => byFile.get(PAGES[page][lang]) as PageSpec;
  const htmlOf = (page: SeoPage, lang: 'en' | 'tr'): string => renderPage(spec(page, lang));
  const textOf = (page: SeoPage, lang: 'en' | 'tr'): string => visible(htmlOf(page, lang));
  const raw = snapshotGames();
  const c = gameCounts();
  const section = (html: string, id: string): string => new RegExp(`<section id="${id}"[^>]*>([\\s\\S]*?)</section>`).exec(html)?.[1] ?? '';
  const slugsIn = (html: string): string[] => [...new Set([...html.matchAll(/href="(?:\/tr)?\/games\/([a-z0-9-]+)\/"/g)].map((m) => m[1] as string))];
  const i18n = { en: createI18n('en'), tr: createI18n('tr') };

  it('there are four pages in each language, at the addresses the footers and the app use', () => {
    for (const page of kinds) {
      for (const lang of LANGS2) {
        expect(spec(page, lang), `${page} ${lang}`).toBeDefined();
        expect(spec(page, lang).url).toBe(SEO_URL[lang][page]);
        expect(spec(page, lang).lang).toBe(lang);
        expect(spec(page, lang).other?.url).toBe(SEO_URL[lang === 'en' ? 'tr' : 'en'][page]);
      }
    }
    // the footer of the content pages, the footer of the app and the pages themselves name the same addresses
    for (const lang of LANGS2) {
      expect(FOOTER_GUIDES[lang].map(([, href]) => href)).toEqual([...kinds.map((k) => SEO_URL[lang][k]), GUIDE_URL[lang]]);
      for (const page of SITE_GUIDE_IDS) expect(siteGuideHref(lang, page), `${lang} ${page}`).toBe(SEO_URL[lang][page]);
    }
    expect([...SITE_GUIDE_IDS].sort()).toEqual([...kinds].sort());
  });

  it('every page of the site links to all four from its footer, and each search page is also linked from the others and from the first guide', () => {
    for (const p of all) {
      const h = renderPage(p);
      for (const k of kinds) expect(h, `${p.file} -> ${k}`).toContain(`<a href="${SEO_URL[p.lang][k]}"`);
    }
    for (const lang of LANGS2) {
      for (const k of kinds) {
        for (const other of kinds.filter((x) => x !== k)) expect(section(htmlOf(k, lang), 'more'), `${k} ${lang} -> ${other}`).toContain(`href="${SEO_URL[lang][other]}"`);
      }
    }
    expect(renderPage(byFile.get('webcam-fitness-games.html') as PageSpec)).toContain('href="/fitness-games"');
    expect(renderPage(byFile.get('tr/kamera-ile-spor-oyunlari.html') as PageSpec)).toContain('href="/tr/evde-spor-oyunlari"');
  });

  it('each page has its own title and its own description, a title that fits a result and a description that does too', () => {
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    for (const page of kinds) {
      for (const lang of LANGS2) {
        const sp = spec(page, lang);
        expect(`${sp.title} | BodyArcade`.length, `${sp.file} title`).toBeLessThanOrEqual(72);
        expect(sp.description.length, `${sp.file} description`).toBeGreaterThanOrEqual(100);
        expect(sp.description.length, `${sp.file} description`).toBeLessThanOrEqual(165);
        titles.add(sp.title);
        descriptions.add(sp.description);
      }
    }
    expect(titles.size).toBe(8);
    expect(descriptions.size).toBe(8);
    for (const p of all.filter((x) => !Object.values(PAGES).some((f) => f.en === x.file || f.tr === x.file))) {
      expect(titles.has(p.title), `${p.file} has the title of a search page`).toBe(false);
    }
  });

  it('the structured data names this page, and its questions are the ones the page shows', () => {
    for (const page of kinds) {
      for (const lang of LANGS2) {
        const html = htmlOf(page, lang);
        const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '{}') as { '@graph': { '@type': string; name?: string; numberOfItems?: number; mainEntity?: { name: string }[]; mainEntityOfPage?: string }[] };
        const types = ld['@graph'].map((g) => g['@type']).sort();
        expect(types, `${page} ${lang}`).toEqual([page === 'hub' ? 'ItemList' : 'Article', 'BreadcrumbList', 'FAQPage'].sort());
        const faq = ld['@graph'].find((g) => g['@type'] === 'FAQPage');
        const shown = [...html.matchAll(/<details class="qa"><summary>([\s\S]*?)<\/summary>/g)].map((m) => (m[1] as string).replace(/<[^>]+>/g, '').trim());
        expect((faq?.mainEntity ?? []).map((q) => q.name), `${page} ${lang}`).toEqual(shown);
        expect(shown.length).toBeGreaterThanOrEqual(4);
        if (page === 'hub') expect(ld['@graph'].find((g) => g['@type'] === 'ItemList')?.numberOfItems).toBe(c.total);
        else expect(ld['@graph'].find((g) => g['@type'] === 'Article')?.mainEntityOfPage).toBe(`${F.SITE}${SEO_URL[lang][page]}`);
      }
    }
  });

  it('English and Turkish say the same numbers (the line with the reading time apart)', () => {
    const numbers = (sp: PageSpec): string[] => {
      const { when: _when, ...rest } = sp;
      const t = visible(renderPage(rest))
        .replace(/BA-[0-9A-Z]{6}/g, ' ').replace(/\d{4}-\d{2}-\d{2}/g, ' ').replace(/(\d),(\d)/g, '$1.$2');
      return [...new Set(t.match(/\d+(?:\.\d+)?/g) ?? [])].sort((a, b) => Number(a) - Number(b));
    };
    for (const page of kinds) expect(numbers(spec(page, 'tr')), page).toEqual(numbers(spec(page, 'en')));
  });

  it('each page names the keyword it answers in its title and its heading, and does not repeat it more than a person would', () => {
    const phrase: Record<SeoPage, { en: string; tr: string }> = {
      hub: { en: 'fitness games', tr: 'evde spor oyunları' },
      seated: { en: 'seated exercise games', tr: 'oturarak egzersiz oyunları' },
      friends: { en: 'with friends', tr: 'arkadaşlarla' },
      areas: { en: 'body area', tr: 'bölgeye göre' },
    };
    for (const page of kinds) {
      for (const lang of LANGS2) {
        const sp = spec(page, lang);
        const key = phrase[page][lang];
        expect(sp.title.toLocaleLowerCase(lang), `${sp.file} title`).toContain(key);
        expect(sp.h1.toLocaleLowerCase(lang), `${sp.file} h1`).toContain(key);
        const text = textOf(page, lang).toLocaleLowerCase(lang);
        const words = text.split(/\s+/).length;
        const uses = text.split(key).length - 1;
        // the footers and the lists of related pages carry the phrase too; one use in fifty words would be stuffing
        expect(uses / words, `${sp.file}: "${key}" ${uses} times in ${words} words`).toBeLessThan(0.02);
      }
    }
  });

  it('the Turkish pages put the suffix after BodyArcade as the name is said (arkeyd: -i, -in, -de), never -ı or -ın', () => {
    for (const page of kinds) expect(textOf(page, 'tr'), page).not.toMatch(/BodyArcade[’']ı/);
  });

  it('claims no health effect: nothing is said to treat, prevent, cure, rehabilitate or lower a risk, and the page that says what the app is not says it plainly', () => {
    const banned = /\b(cures?|heals?|prevents? (falls|injur)|fall prevention|lowers? (the |your )?risk|reduces? (the |your )?risk|clinically|proven|improves? (your )?balance|rehabilitates?|iyileştirir|tedavi eder|önler|kanıtlanmış)\b/i;
    for (const page of kinds) for (const lang of LANGS2) expect(textOf(page, lang).replace(/no claim that they improve your balance/g, ''), `${page} ${lang}`).not.toMatch(banned);
    expect(textOf('seated', 'en')).toContain('not a medical device, a rehabilitation programme or a falls-prevention programme');
    expect(textOf('seated', 'tr')).toContain('tıbbi bir cihaz, rehabilitasyon programı ya da düşmeyi önleme programı değildir');
    // what the app itself says about health, in its own words
    expect(i18n.en.tx('game.measures.not')).toBe('It does not measure heart rate or give medical advice.');
    expect(i18n.en.tx('onboarding.s4.health')).toContain('Check with a doctor if you are pregnant, have a heart or joint condition, or feel pain when you move. Stop if you feel dizzy or a sharp pain.');
    for (const lang of LANGS2) for (const page of ['hub', 'seated'] as const) expect(textOf(page, lang), `${page} ${lang}`).toMatch(lang === 'en' ? /Check with a doctor/ : /doktoruna danış/);
  });

  describe('the games', () => {
    it('every game has its line of what the body does, in both languages, and no line is for a game that does not exist', () => {
      expect(Object.keys(MOVE).sort()).toEqual(raw.map((g) => g.id).sort());
      for (const g of raw) { expect(MOVE[g.id]?.en.length).toBeGreaterThan(10); expect(MOVE[g.id]?.tr.length).toBeGreaterThan(10); }
    });

    it('the games the copy names are the games the manifests describe: the two that are not low impact, the three most intense, the four seen from the waist up, the one without a quiet mode', () => {
      expect(raw.filter((g) => !g.lowImpact).map((g) => g.id).sort()).toEqual(['firework-jacks', 'road-run']);
      expect([...raw].sort((a, b) => b.met - a.met).slice(0, 3).map((g) => g.id)).toEqual(['firework-jacks', 'knee-sprint', 'road-run']);
      expect(raw.filter((g) => g.framing === 'upper').map((g) => g.id).sort()).toEqual(['limbo-bend', 'pad-work', 'star-catch', 'twist-turbine']);
      expect(raw.filter((g) => g.framing === 'full').length + raw.filter((g) => g.framing === 'upper').length).toBe(c.total);
      expect(raw.filter((g) => !g.quiet).map((g) => g.id)).toEqual(['road-run']);
      // Firework Jacks and Road Run are what the seated page says they become
      expect(raw.find((g) => g.id === 'firework-jacks')?.seatedNote?.en).toContain('Arm jacks');
      expect(raw.find((g) => g.id === 'road-run')?.seatedNote?.en).toContain('No jumping needed');
    });

    it('every game has a seated note and what the camera reads, in both languages (the seated and the area pages quote them)', () => {
      for (const g of raw) {
        for (const lang of LANGS2) {
          expect(g.seatedNote?.[lang]?.length, `${g.id} seated note ${lang}`).toBeGreaterThan(10);
          expect(g.measures.length, g.id).toBeGreaterThan(0);
          for (const m of g.measures) expect(m[lang].length, `${g.id} measure ${lang}`).toBeGreaterThan(10);
        }
      }
    });

    it('the pages that list the games call a free game free and a Pro game Pro', () => {
      for (const lang of LANGS2) {
        const free = lang === 'en' ? 'Free' : 'Ücretsiz';
        const heading = lang === 'en' ? 'Free or Pro' : 'Ücretsiz mi, Pro mu';
        for (const page of ['hub', 'seated'] as const) {
          const html = htmlOf(page, lang);
          for (const g of gameList(lang)) {
            const row = new RegExp(`<tr><th scope="row"><a href="[^"]*/games/${g.slug}/">[^<]+</a></th>([\\s\\S]*?)</tr>`).exec(html)?.[1] ?? '';
            expect(row, `${page} ${lang} ${g.id}`).not.toBe('');
            expect(new RegExp(`data-label="${heading}">${g.free ? free : 'Pro'}</td>`).test(row), `${page} ${lang} ${g.id} is ${g.free ? 'free' : 'Pro'}`).toBe(true);
          }
        }
        const areas = htmlOf('areas', lang);
        for (const g of gameList(lang)) {
          const marks = [...areas.matchAll(new RegExp(`<strong><a href="[^"]*/games/${g.slug}/">[^<]+</a></strong> \\((Free|Pro|Ücretsiz)[,)]`, 'g'))];
          expect(marks.length, `${lang} ${g.id} is named in the areas`).toBeGreaterThan(0);
          for (const m of marks) expect(m[1], `${lang} ${g.id}`).toBe(g.free ? free : 'Pro');
        }
      }
    });

    it('free and Pro: the lists the pages give are the manifests, the plans and the feature rules of the entitlements', () => {
      const free = { plan: 'free', source: 'none' } as const;
      const rules = { isFreeGame: (id: string) => raw.some((g) => g.id === id && g.free) };
      for (const g of raw) expect(canUse(`game:${g.id}`, free, rules), g.id).toBe(g.free);
      expect(canUse('difficulty:easy', free, rules)).toBe(true);
      expect(canUse('difficulty:medium', free, rules)).toBe(true);
      expect(canUse('difficulty:hard', free, rules)).toBe(false);
      expect(i18n.en.tx('paywall.benefit.levels')).toBe('Hard and Expert difficulty');
      expect(i18n.tr.tx('paywall.benefit.levels')).toBe('Zor ve Uzman seviyeler');
      // four of the five plans are Pro, and the one that is not is the free plan of the data
      const proPlans = WORKOUT_PLANS.filter((p) => !canUse(`plan:${p.id}`, free, rules));
      expect(proPlans.length).toBe(WORKOUT_PLANS.length - 1);
      for (const lang of LANGS2) {
        const t = textOf('hub', lang);
        expect(t).toContain(lang === 'en' ? `Of the ${c.total} games, ${c.free} are free` : `${c.total} oyunun ${c.free} tanesi ücretsiz`);
        expect(t).toContain(lang === 'en' ? 'Hard and Expert' : 'Zor ve Uzman');
        expect(t).toContain(lang === 'en' ? `${proPlans.length} of the ${WORKOUT_PLANS.length} workout plans (Desk break is free)` : `${WORKOUT_PLANS.length} antrenman planının ${proPlans.length} tanesi (Masa molası ücretsiz)`);
      }
      expect(FREE_PLAN_ID).toBe('desk-break');
      expect(i18n.en.tx('setup.note.once')).toBe('This game is part of Pro. You can play it once for free.');
    });
  });

  describe('the seated page', () => {
    it('quotes the seated note of every game, in both languages', () => {
      for (const lang of LANGS2) {
        const t = textOf('seated', lang);
        for (const g of raw) expect(t, `${lang} ${g.id}`).toContain((g.seatedNote as { en: string; tr: string })[lang]);
      }
    });

    it('the Easy 60+ plan is what the data says: three free, low-impact games at Easy, thirty seconds of rest, seated unless the player said otherwise; the Desk break is the free plan and always seated', () => {
      const plan = WORKOUT_PLANS.find((p) => p.id === 'easy-60');
      expect(plan?.audience).toBe('seniors');
      expect(plan?.steps.map((s) => s.game)).toEqual(['pose-wall', 'twist-turbine', 'star-catch']);
      expect(plan?.steps.every((s) => s.difficulty === 'easy')).toBe(true);
      expect(plan?.steps.slice(0, -1).map((s) => s.restSec)).toEqual([30, 30]);
      for (const s of plan?.steps ?? []) { const g = raw.find((x) => x.id === s.game); expect(g?.free, s.game).toBe(true); expect(g?.lowImpact, s.game).toBe(true); }
      expect(plan && seatedFor(plan, null)).toBe(true);
      expect(plan && seatedFor(plan, false)).toBe(false);
      const desk = WORKOUT_PLANS.find((p) => p.id === FREE_PLAN_ID);
      expect(desk?.seating).toBe('always');
      expect(desk?.steps.map((s) => s.game)).toEqual(['twist-turbine', 'star-catch']);
      // minutes: the rounds of the manifests plus the rests, worked out here again
      const minutes = (p: typeof plan): number => Math.max(1, Math.round(((p?.steps ?? []).reduce((n, s) => n + (raw.find((g) => g.id === s.game)?.seconds ?? 0), 0) + (p?.steps ?? []).slice(0, -1).reduce((n, s) => n + s.restSec, 0)) / 60));
      for (const lang of LANGS2) {
        const t = textOf('seated', lang);
        expect(t).toContain(lang === 'en' ? `about ${minutes(plan)} minutes in all` : `toplam yaklaşık ${minutes(plan)} dakika`);
        expect(t).toContain(lang === 'en' ? `about ${minutes(desk)} minutes` : `yaklaşık ${minutes(desk)} dakika`);
        expect(t).toContain(lang === 'en' ? 'with 30 seconds of rest' : '30 saniye dinlenmeyle');
        expect(t).toContain(lang === 'en' ? 'Pose Wall, Twist Turbine and Star Catch' : 'Pose Wall, Twist Turbine ve Star Catch');
      }
      expect(i18n.en.tx('plans.description')).toContain('an easy plan for 60 and over');
    });

    it('the buttons and settings it names are the ones the app has, in both languages', () => {
      for (const lang of LANGS2) {
        for (const key of ['settings.seated', 'nav.settings', 'calib.seatedInstead', 'calib.desk.cta', 'game.section.variants', 'settings.quiet']) expect(i18n[lang].has(key), `${lang} ${key}`).toBe(true);
        const t = textOf('seated', lang);
        for (const key of ['settings.seated', 'calib.seatedInstead', 'game.section.variants']) expect(t, `${lang} ${key}`).toContain(i18n[lang].tx(key));
      }
      expect(i18n.en.tx('calib.msg.desk_back')).toBe('Sit back a little so your head, shoulders and arms show.');
      expect(i18n.en.tx('game.framing.upper.tip')).toContain('about 1 m away');
      expect(i18n.en.tx('calib.headroom')).toContain('When you raise your arms, your hands should stay in view.');
      // the games that ask for the hands-up check (the seated page says "a few games")
      for (const id of ['firework-jacks', 'limbo-bend', 'pose-wall']) expect(read(`packages/games/${id}/manifest.json`), id).toContain('"headroom": "arms-up"');
    });
  });

  describe('the friends page', () => {
    it('names the games with a live race and the games that share a camera, as the manifests have them, and the rest of a room is the code', () => {
      expect(raw.filter((g) => g.live).map((g) => g.id).sort()).toEqual(['knee-sprint', 'reaction-tag', 'squat-flap']);
      expect(raw.filter((g) => g.live && !g.free).map((g) => g.id)).toEqual(['reaction-tag']);
      for (const lang of LANGS2) {
        // a Pro game with a live race is never called free, and the page says who needs Pro for it: the host, not the friends
        const t = textOf('friends', lang);
        const limits = section(htmlOf('friends', lang), lang === 'en' ? 'limits' : 'beklenti');
        expect(slugsIn(limits).sort()).toEqual(raw.filter((g) => g.live).map((g) => g.slug).sort());
        expect(t).not.toMatch(lang === 'en' ? /Reaction Tag[^.]*(are|is a) free/ : /Reaction Tag[^.]*ücretsiz/);
        expect(t).toContain(lang === 'en' ? 'Reaction Tag is a Pro game: a room can hold it when its host has Pro, and the friends who join do not need Pro.' : 'Reaction Tag bir Pro oyundur: ev sahibinde Pro varsa oda onu açabilir, katılan arkadaşlarda Pro gerekmez.');
        expect(t).not.toMatch(lang === 'en' ? /both are free|the two games with live races/ : /ikisi de ücretsiz|Canlı yarışı olan iki oyun/);
      }
      expect(raw.filter((g) => g.local2).length).toBe(c.local2);
      for (const lang of LANGS2) {
        const sect = section(htmlOf('friends', lang), lang === 'en' ? 'screen' : 'ekran');
        expect(slugsIn(sect).sort()).toEqual(raw.filter((g) => g.local2).map((g) => g.slug).sort());
        const t = textOf('friends', lang);
        expect(t).toContain(lang === 'en' ? `A room holds ${MIN_SEATS} to ${MAX_SEATS} players` : `Bir odada ${MIN_SEATS} ile ${MAX_SEATS} oyuncu bulunur`);
        expect(t).toContain(lang === 'en' ? `the ${ROOM_CODE_LENGTH}-character room code` : `${ROOM_CODE_LENGTH} karakterli oda kodu`);
        expect(t).toContain(lang === 'en' ? `a skeleton of ${POSE_JOINTS.length} joints` : `${POSE_JOINTS.length} eklemli bir iskeleti`);
        expect(t).toContain(String(F.SHARE_HZ));
      }
      expect(POSE_JOINTS.length).toBe(F.SHARED_JOINTS);
      // the friend code the page shows has the shape of a real one
      expect('BA-7K2Q4X').toMatch(new RegExp(`^BA-[0-9A-Z]{${FRIEND_CODE_LEN}}$`));
      expect(i18n.en.tx('social.intro.cta')).toBe('Make my profile');
      expect(i18n.tr.tx('social.intro.cta')).toBe('Profilimi oluştur');
      expect(i18n.en.tx('room.game.label')).toBe('The host picks the game');
    });

    it('the ages are the ones of the policy: nothing under 16, preset words from 16, typed text and video only between adults', () => {
      expect(POLICY.child.online).toBe(false);
      expect(POLICY.teen.freeText).toBe(false);
      expect(POLICY.teen.video).toBe(false);
      expect(POLICY.adult.freeText).toBe(true);
      expect(canSendFriendRequest('adult', 'teen')).toBe(false);
      for (const lang of LANGS2) {
        const t = textOf('friends', lang);
        expect(t).toContain(lang === 'en' ? `Under ${F.AGE.online}: no online profile` : `${F.AGE.online} yaşından küçükler: çevrimiçi profil yok`);
        expect(t).toContain(lang === 'en' ? `${F.AGE.online} to 17` : `${F.AGE.online} ile 17 arası`);
        expect(t).toContain(lang === 'en' ? `${F.AGE.video} and over` : `${F.AGE.video} yaş ve üzeri`);
      }
    });

    it("how long a room lasts is the server's timing", () => {
      expect(DEFAULT_TIMING.emptyTtlMs / 60_000).toBe(F.ROOM_EMPTY_MINUTES);
      expect(DEFAULT_TIMING.roomTtlMs / 3_600_000).toBe(F.ROOM_IDLE_HOURS);
      for (const lang of LANGS2) {
        const t = textOf('friends', lang);
        expect(t).toContain(String(F.ROOM_EMPTY_MINUTES));
        expect(t).toContain(String(F.ROOM_IDLE_HOURS));
      }
    });
  });

  describe('the body-area page', () => {
    it('every area section lists the games whose manifests name that area, and no other; each game is described once in full and elsewhere only pointed back to', () => {
      for (const lang of LANGS2) {
        const html = htmlOf('areas', lang);
        for (const region of ['legs', 'arms', 'core', 'cardio', 'mobility'] as const) {
          const listed = slugsIn(section(html, region)).sort();
          expect(listed, `${lang} ${region}`).toEqual(raw.filter((g) => (g.regions as string[]).includes(region)).map((g) => g.slug).sort());
        }
        // the one game of Chest and back is named under Arms and shoulders, which it is in as well
        expect(raw.filter((g) => (g.regions as string[]).includes('chest-back')).map((g) => g.id)).toEqual(['summit-climb']);
        expect(raw.find((g) => g.id === 'summit-climb')?.regions).toContain('arms');
        const reads = lang === 'en' ? 'The camera reads' : 'Kamera şunları okur';
        for (const g of raw) expect((html.match(new RegExp(`/games/${g.slug}/">[^<]+</a></strong> \\([^)]+\\)\\. ${reads}`, 'g')) ?? []).length, `${lang} ${g.id}`).toBe(1);
      }
    });

    it("the app has a list for each area the page links to, in both languages, and the words are the app's", () => {
      for (const lang of LANGS2) {
        const html = htmlOf('areas', lang);
        for (const region of REGION_ORDER) {
          const href = `${lang === 'tr' ? '/tr' : ''}/workouts/${region}/`;
          expect(router.match(href)?.id, href).toBe('region');
          expect(html, `${lang} ${region}`).toContain(`href="${href}"`);
          expect(html).toContain(i18n[lang].tx(`region.${region}`));
        }
        expect(html).toContain(i18n[lang].tx('home.filters'));
      }
      expect(raw.every((g) => g.regions.length >= 1 && g.regions.length <= 3)).toBe(true);
    });
  });

  it('the links to the plans and to the Pro page are routes of the app', () => {
    for (const lang of LANGS2) {
      expect(router.match(`${lang === 'tr' ? '/tr' : ''}/plans/`)?.id).toBe('plans');
      expect(router.match(`${lang === 'tr' ? '/tr' : ''}/pro/`)?.id).toBe('pro');
    }
  });
});

describe('the stylesheet uses the design tokens', () => {
  const hexes = (block: string): Map<string, string> => new Map([...block.matchAll(/(--ba-[a-z-]+):\s*(#[0-9A-Fa-f]{6})\b/g)].map((m) => [m[1] as string, (m[2] as string).toUpperCase()]));
  const tokens = read('design/tokens/tokens.css');
  const css = read('packages/web/content/content.css');
  const lightTokens = hexes(/:root \{([\s\S]*?)\n\}/.exec(tokens)?.[1] ?? '');
  const darkTokens = hexes(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\n  \}/.exec(tokens)?.[1] ?? '');
  const lightCss = hexes(/:root \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '');
  const darkCss = hexes(/@media \(prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)\n  \}/.exec(css)?.[1] ?? '');

  it('finds the colours', () => {
    expect(lightCss.size).toBeGreaterThan(10);
    expect(darkCss.size).toBeGreaterThan(5);
    expect(lightTokens.size).toBeGreaterThan(20);
    expect(darkTokens.size).toBeGreaterThan(10);
  });

  it('every colour is the token of the same name, in the light theme and in the dark one', () => {
    for (const [name, value] of lightCss) expect(lightTokens.get(name), `light ${name}`).toBe(value);
    for (const [name, value] of darkCss) expect(darkTokens.get(name), `dark ${name}`).toBe(value);
  });

  it('loads no font file and names none of the faces the style forbids', () => {
    expect(css).not.toMatch(/@font-face|fonts\.googleapis/);
    expect(css).not.toMatch(/font-family:[^;]*\b(Inter|Poppins|Manrope|Montserrat|Open Sans|Lato|Nunito|Raleway|Space Grotesk)\b/);
  });
});

// ───────── the release gate (BA_RELEASE=1) ─────────

describe.runIf(process.env['BA_RELEASE'] === '1')('release gate: the pages promise only what the product has', () => {
  it('the Family plan is on the paywall (boot.ts FAMILY_ON)', () => {
    expect(read('packages/web/src/app/boot.ts')).toMatch(/export const FAMILY_ON = true;/);
  });

  it('a Pro player can reach the other seven Road Run worlds (the terms, the FAQ, the paywall and the store listing say Pro adds them)', () => {
    // The shell has to pass a world to the game for a player who may use it (StartOptions.world, can('world:<id>')). Today the runner picks a
    // free world by itself and no screen offers a choice, so the seven worlds of Pro cannot be played: build the choice, or take the promise out.
    const files = ['packages/web/src/views/game.ts', 'packages/web/src/app/play.ts', 'packages/web/src/app/session.ts', 'packages/web/src/app/app.ts'];
    // a boolean, so a failing run prints one line and not the files that were searched
    const offersWorlds = /['"`]world:|name="world"/.test(files.map(read).join('\n'));
    expect(offersWorlds, `no screen of the shell lets a player choose a world (searched ${files.join(', ')} for can('world:...') or a world input)`).toBe(true);
  });

  it('the search pages promise friends, rooms, lobbies and workout plans: the app has the routes, the real social services start, and the plan the seated page names exists', () => {
    const ids = ROUTES.map((r) => r.id as string);
    for (const id of ['friends', 'room', 'lobbies', 'friendlink', 'plans']) expect(ids, id).toContain(id);
    expect(read('packages/web/src/app/boot.ts')).toContain('startServices()');
    expect(WORKOUT_PLANS.some((p) => p.id === 'easy-60')).toBe(true);
  });

  it('the profile screen has the two buttons the privacy policy names', () => {
    const strings = read('packages/web/src/social/strings.ts');
    expect(strings).toContain("'me.dataDownload': 'Download my data'");
    expect(strings).toContain("'me.dataDelete': 'Delete my profile'");
    expect(strings).toContain("'me.dataDownload': 'Verilerimi indir'");
    expect(strings).toContain("'me.dataDelete': 'Profilimi sil'");
  });

  it('the app footer leads a Turkish player to the Turkish legal pages', () => {
    const footer = read('packages/web/src/views/chrome.ts');
    expect(footer).toContain('/tr/privacy');
    expect(footer).toContain('/tr/terms');
  });

  it('the Android app flag says what Google Play says', () => {
    // set by the release that goes with the public listing; this test only makes the choice visible
    expect(typeof F.ANDROID_APP_LIVE).toBe('boolean');
  });
});
