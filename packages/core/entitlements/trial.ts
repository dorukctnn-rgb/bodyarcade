// The promise on the paywall, "we will remind you two days before your free trial ends", and how the app keeps it.
//
//   The notice in the app    on every open of the last two days of the trial (trialNotice, notice()). Nothing is remembered
//                            between two opens: the answer is a pure function of the trial's end and the clock, so a person
//                            who opens the app three times on the last day sees it three times and one who never opens
//                            it again has not been tricked into anything either. It needs no network and no address.
//   The e-mail               on the web only, and only for a person who typed an address into the box (setEmail). The
//                            address goes to our server with the signed token of the purchase, which holds it until it has
//                            sent the one e-mail and then deletes it. The app keeps no address: only a masked form
//                            ("a***@example.com") to show that one was given, and when the e-mail will go out.
//   Google Play              the store sends its own reminder, so the Android build asks for no address and calls nothing
//                            (the in-app notice still shows, saying where to cancel).
//
// Only Pro yearly has a trial (plans.ts), so only it has anything to remind about: a plan without a trial claim in its
// token has no notice, no box and no e-mail. A membership that was already cancelled runs out by itself and charges
// nothing: the notice says so and the box is not offered (the server would refuse the address as well).
import { dayOf, daysBetween, p, schemaOf, type BodyArcadeStore, type Slot } from '../store/index.ts';
import type { Entitlement } from '../types/index.ts';
import { API, EMAIL_RE, MAX_EMAIL_LENGTH, REMINDER_LANGS, REMINDER_LEAD_MS, errorCodeOf, type ReminderLang } from './api.ts';
import type { EntitlementsService } from './manager.ts';
import type { PlanId } from './plans.ts';
import { b64urlDecode } from './token.ts';
import { defaultFetch, getJson, postJson, type FetchLike, type HttpAnswer } from './providers/shared.ts';

/** The in-app notice starts this long before the trial ends: the two days the paywall promises. */
export const NOTICE_LEAD_MS = REMINDER_LEAD_MS;
/** What the server said about its mail service is believed this long (a failed question is repeated after a minute). */
const BOX_TTL_MS = 10 * 60_000;
const BOX_RETRY_MS = 60_000;
const NS = 'entitlements';

/** What the notice needs to know about the holder: the manager's status has all of it. */
export interface TrialSubject {
  source: Entitlement['source'];
  /** Epoch ms when a cancelled membership's paid period ends; null while it renews. */
  paidUntil: number | null;
  /** Epoch ms when the free trial ends; null when none is running. */
  trialEnds: number | null;
  planId?: PlanId | null;
}

export interface TrialNotice {
  /** Epoch ms when the trial ends. */
  endsAt: number;
  msLeft: number;
  /** Calendar days from today to the day the trial ends, in the player's own time zone: 0 today, 1 tomorrow, 2 the day after. */
  dayOffset: number;
  /** Where the membership is cancelled: Google Play for a Play purchase, the purchase receipt for a web purchase. */
  where: 'web' | 'play';
  /** The membership was cancelled already: the trial runs out and nothing is charged. */
  cancelled: boolean;
  planId?: PlanId;
}

const validTime = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;

/** The day of an instant in the given zone; a zone the platform does not know falls back to the device's own. */
function localDay(ms: number, timeZone: string | undefined): string {
  try { return dayOf(ms, timeZone); } catch { return dayOf(ms); }
}

/**
 * The notice for this moment, or null: there is none without a running trial, none before the last two days and none
 * once the trial has ended. The trial ends at `trialEnds`; the last instant it lasts is the one before, so a trial that
 * ends at midnight belongs to the day that is closing ("tomorrow" at 24:00 of tomorrow, not "the day after").
 */
export function trialNotice(s: TrialSubject, o: { now: number; timeZone?: string }): TrialNotice | null {
  const { now } = o;
  if (!Number.isFinite(now) || s.source === 'none') return null;
  const end = s.trialEnds;
  if (!validTime(end)) return null;
  const msLeft = end - now;
  if (msLeft <= 0 || msLeft > NOTICE_LEAD_MS) return null;
  const dayOffset = daysBetween(localDay(now, o.timeZone), localDay(end - 1, o.timeZone));
  return {
    endsAt: end,
    msLeft,
    dayOffset,
    where: s.source === 'play' ? 'play' : 'web',
    cancelled: s.paidUntil !== null,
    ...(s.planId ? { planId: s.planId } : {}),
  };
}

/** "alice@example.com" -> "a***@example.com": enough to recognise one's own address, not enough to read anybody else's. */
export function maskEmail(email: string): string {
  const at = typeof email === 'string' ? email.lastIndexOf('@') : -1;
  if (at < 1 || at === email.length - 1) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (/\s/.test(email) || domain.includes('@')) return '***';
  return `${[...local][0] as string}***@${domain}`;
}

/** The language of the e-mail: the app's language, region dropped, English when it is none of the five. */
export function reminderLangOf(language: unknown): ReminderLang {
  const base = typeof language === 'string' ? (language.trim().toLowerCase().split(/[-_]/)[0] ?? '') : '';
  return (REMINDER_LANGS as readonly string[]).includes(base) ? (base as ReminderLang) : 'en';
}

export type TrialFailure = 'bad_email' | 'not_offered' | 'no_trial' | 'unavailable' | 'rate_limited' | 'network';
export type TrialResult = { ok: true; sendAt: number | null } | { ok: false; code: TrialFailure };

export interface TrialView {
  /** Epoch ms when the free trial ends; null when none is running. */
  trialEnds: number | null;
  notice: TrialNotice | null;
  /** 'offer': show the box for an address. 'set': an address was given (see `masked`). 'none': nothing to show. */
  email: 'none' | 'offer' | 'set';
  masked: string | null;
  /** Epoch ms when the e-mail will go out; null without an address. */
  sendAt: number | null;
}

export interface TrialService {
  /** The notice for now, without waiting for anything. */
  notice(): TrialNotice | null;
  /** The notice and the state of the e-mail box. Asks the server once in a while whether it can send mail at all. */
  view(): Promise<TrialView>;
  /** Leaves an address for the one e-mail. The language is the app's (any tag: only its first part counts). Never throws. */
  setEmail(email: string, language: string): Promise<TrialResult>;
  /** Takes the address back from the server and forgets it here. Never throws. */
  clearEmail(): Promise<TrialResult>;
}

export interface TrialOptions {
  service: EntitlementsService;
  store: BodyArcadeStore;
  /** 'play': the store sends its own reminder, so no address is asked for and nothing is sent to our server. */
  mode: 'web' | 'play';
  fetch?: FetchLike;
  /** Origin of the API; empty for the page's own origin. */
  baseUrl?: string;
  now?: () => number;
  /** IANA zone for "today"; default the device's own. */
  timeZone?: string;
  timeoutMs?: number;
}

interface HeldAddress { sub: string; trialEnds: number; masked: string; lang: ReminderLang; sendAt: number }

const HeldSchema = schemaOf<HeldAddress | null>(1, p.nullable(p.object({
  sub: p.string({ pattern: /^[0-9a-f]{16}$/, min: 16, max: 16 }),
  trialEnds: p.epoch(),
  masked: p.string({ max: 80 }),
  lang: p.oneOf(REMINDER_LANGS),
  sendAt: p.epoch(),
})));

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Which purchase a token is for (the start of its `sub`). Only ever read from a token the manager has already checked. */
function purchaseOf(token: string | undefined): string | null {
  if (typeof token !== 'string') return null;
  const mid = token.split('.')[1];
  const bytes = mid === undefined ? null : b64urlDecode(mid);
  if (!bytes) return null;
  try {
    const sub = (JSON.parse(new TextDecoder().decode(bytes)) as { sub?: unknown }).sub;
    return typeof sub === 'string' && /^[0-9a-f]{64}$/.test(sub) ? sub.slice(0, 16) : null;
  } catch {
    return null;
  }
}

const fail = (code: TrialFailure): TrialResult => ({ ok: false, code });

/** What an answer that was not a success means for the person. */
function failureOf(a: HttpAnswer): TrialFailure {
  const code = errorCodeOf(a.body);
  if (a.status === 429 || code === 'rate_limited') return 'rate_limited';
  if (code === 'no_trial' || code === 'not_found') return 'no_trial';
  if (a.status === 400 && code === 'bad_request') return 'bad_email';
  return 'unavailable';
}

export function createTrial(o: TrialOptions): TrialService {
  const { service, mode } = o;
  const now = o.now ?? Date.now;
  const f = o.fetch ?? defaultFetch;
  const url = (path: string): string => `${o.baseUrl ?? ''}${path}`;
  const held: Slot<HeldAddress | null> = o.store.ns(NS).slot<HeldAddress | null>('trial-reminder', HeldSchema, null);

  /** What the server said about its mail service, and until when that is believed. */
  let box: { on: boolean; until: number } | null = null;
  let asking: Promise<boolean> | null = null;

  function mailOn(): Promise<boolean> {
    const t = now();
    if (box !== null && t < box.until) return Promise.resolve(box.on);
    asking ??= (async () => {
      const a = await getJson(f, url(API.key), o.timeoutMs);
      const answered = a !== null && a.status === 200 && isRecord(a.body);
      const on = answered && (a.body as Record<string, unknown>)['reminders'] === true;
      box = { on, until: now() + (answered ? BOX_TTL_MS : BOX_RETRY_MS) };
      return on;
    })().finally(() => { asking = null; });
    return asking;
  }

  /** The running trial of this device, or null (ended, never was, no purchase). */
  function running(): { trialEnds: number; paidUntil: number | null; sub: string | null } | null {
    const st = service.status();
    const t = now();
    if (st.source === 'none' || !validTime(st.trialEnds) || st.trialEnds <= t) return null;
    return { trialEnds: st.trialEnds, paidUntil: st.paidUntil, sub: purchaseOf(service.current().token) };
  }

  /** The address left for THIS trial, or null; an address left for another trial is forgotten. */
  function mine(trial: { trialEnds: number; sub: string | null }): HeldAddress | null {
    const h = held.get();
    if (h === null) return null;
    if (h.sub === trial.sub && h.trialEnds === trial.trialEnds) return h;
    held.remove();
    return null;
  }

  const notice = (): TrialNotice | null => trialNotice(service.status(), { now: now(), ...(o.timeZone ? { timeZone: o.timeZone } : {}) });

  return {
    notice,

    async view() {
      const trial = running();
      if (!trial) {
        if (held.get() !== null) held.remove();                       // the trial is over: nothing left to remind of
        return { trialEnds: null, notice: null, email: 'none', masked: null, sendAt: null };
      }
      const base = { trialEnds: trial.trialEnds, notice: notice() };
      // A cancelled membership runs out by itself and charges nothing, and the Android app has the store's own reminder.
      if (mode !== 'web' || trial.paidUntil !== null) return { ...base, email: 'none', masked: null, sendAt: null };
      const h = mine(trial);
      if (h) return { ...base, email: 'set', masked: h.masked, sendAt: h.sendAt };
      return { ...base, email: (await mailOn()) ? 'offer' : 'none', masked: null, sendAt: null };
    },

    async setEmail(raw, language) {
      try {
        if (mode !== 'web') return fail('not_offered');
        const email = typeof raw === 'string' ? raw.trim() : '';
        if (email.length === 0 || email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) return fail('bad_email');
        const trial = running();
        const token = service.current().token;
        if (!trial || trial.paidUntil !== null || typeof token !== 'string') return fail('no_trial');
        if (trial.sub === null) return fail('unavailable');
        const lang = reminderLangOf(language);
        const a = await postJson(f, url(API.reminder), { token, did: service.deviceId(), email, lang }, o.timeoutMs);
        if (!a) return fail('network');
        const sendAt = isRecord(a.body) ? a.body['sendAt'] : undefined;
        if (a.status !== 200 || !isRecord(a.body) || a.body['ok'] !== true || !validTime(sendAt)) return fail(a.status === 200 ? 'unavailable' : failureOf(a));
        held.set({ sub: trial.sub, trialEnds: trial.trialEnds, masked: maskEmail(email), lang, sendAt });
        return { ok: true, sendAt };
      } catch {
        return fail('unavailable');
      }
    },

    async clearEmail() {
      try {
        if (mode !== 'web') return fail('not_offered');
        const had = held.get();
        if (had === null) return { ok: true, sendAt: null };           // nothing was given: nothing to take back
        const token = service.current().token;
        const trial = running();
        if (trial && typeof token === 'string' && mine(trial)) {
          const a = await postJson(f, url(API.reminder), { token, did: service.deviceId(), email: null, lang: had.lang }, o.timeoutMs);
          if (!a) return fail('network');
          if (a.status !== 200 || !isRecord(a.body) || a.body['ok'] !== true) return fail(failureOf(a));
        }
        // The server has let go of it, or this purchase and its trial are gone and the server drops the address by itself.
        held.remove();
        return { ok: true, sendAt: null };
      } catch {
        return fail('unavailable');
      }
    },
  };
}
